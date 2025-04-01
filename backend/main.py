# backend/main.py
import os
import asyncio
import logging
import json
import pandas as pd
from datetime import datetime
import openai
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from deepgram import (
    DeepgramClient,
    DeepgramClientOptions,
    LiveTranscriptionEvents,
    LiveOptions,
)

# --- Configuración Inicial ---
load_dotenv()  # Carga variables de entorno desde .env

API_KEY = os.getenv("DEEPGRAM_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not API_KEY:
    raise ValueError("DEEPGRAM_API_KEY no encontrada en las variables de entorno.")
if not OPENAI_API_KEY:
    raise ValueError("OPENAI_API_KEY no encontrada en las variables de entorno.")

# Configurar OpenAI
openai.api_key = OPENAI_API_KEY

# Setup logging
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

# Deepgram Client Configuration
config: DeepgramClientOptions = DeepgramClientOptions(
    verbose=logging.DEBUG
)

# Initialize Deepgram Client
deepgram: DeepgramClient = DeepgramClient(API_KEY, config)

app = FastAPI()

@app.websocket("/ws/transcribe")
async def websocket_endpoint(websocket: WebSocket):
    """Maneja conexiones WebSocket de clientes para transcripción en tiempo real."""
    await websocket.accept()
    logger.info(f"Cliente conectado: {websocket.client}")

    dg_connection = None
    full_transcript = []  # Almacena la transcripción completa
    is_final = False  # Indica si el fragmento es final o parcial

    try:
        dg_connection = deepgram.listen.asynclive.v("1")
        logger.info("Conexión asíncrona de Deepgram creada.")

        async def on_message(self, result, **kwargs):
            """Callback para cuando se recibe una transcripción."""
            nonlocal full_transcript  # Add this line to access the outer variable
            
            try:
                transcript = result.channel.alternatives[0].transcript
                is_final = result.is_final  # Use is_final directly from the response
                
                if len(transcript) > 0:
                    # Solo enviamos al cliente los resultados finales o parciales con indicador
                    message = {
                        "transcript": transcript,
                        "is_final": is_final
                    }
                    
                    # Si es un resultado final, lo guardamos para análisis posterior
                    if is_final and transcript.strip():
                        logger.info(f"Adding final transcript segment: '{transcript}'")
                        full_transcript.append(transcript)
                        logger.info(f"Current transcript segments: {len(full_transcript)}")
                    
                    await websocket.send_text(json.dumps(message))
            except WebSocketDisconnect:
                logger.warning("Cliente desconectado antes de enviar mensaje.")
            except Exception as e:
                logger.error(f"Error al procesar/enviar mensaje: {e}")

        # --- Resto de handlers de eventos ---
        async def on_metadata(self, metadata, **kwargs):
            logger.debug(f"Deepgram metadata: {metadata}")

        async def on_speech_started(self, speech_started, **kwargs):
            logger.debug("Deepgram speech_started")

        async def on_utterance_end(self, utterance_end, **kwargs):
            logger.debug("Deepgram utterance_end")

        async def on_error(self, error, **kwargs):
            error_message = error.get("message", str(error))
            logger.error(f"Error de Deepgram: {error_message}")
            try:
                await websocket.send_text(json.dumps({"error": error_message}))
            except Exception as e:
                logger.error(f"Error al enviar mensaje de error: {e}")

        async def on_open(self, open_event, **kwargs):
            """Callback cuando la conexión con Deepgram se abre."""
            logger.info(f"Conexión Deepgram abierta: {open_event}")

        # Fix the on_close handler to properly handle the close_event parameter
        async def on_close(self, close_event=None, **kwargs):
            """Callback cuando la conexión con Deepgram se cierra."""
            logger.info(f"Conexión Deepgram cerrada: {close_event}")

        # --- Registrar Handlers de Eventos ---
        dg_connection.on(LiveTranscriptionEvents.Transcript, on_message)
        dg_connection.on(LiveTranscriptionEvents.Metadata, on_metadata)
        dg_connection.on(LiveTranscriptionEvents.SpeechStarted, on_speech_started)
        dg_connection.on(LiveTranscriptionEvents.UtteranceEnd, on_utterance_end)
        dg_connection.on(LiveTranscriptionEvents.Error, on_error)
        dg_connection.on(LiveTranscriptionEvents.Open, on_open)
        dg_connection.on(LiveTranscriptionEvents.Close, on_close)

        # --- Opciones de Transcripción de Deepgram ---
        options = LiveOptions(
            model="nova-2",
            language="es",
            smart_format=True,
            interim_results=True,
            utterance_end_ms="1000",
            vad_events=True,
        )

        await dg_connection.start(options)
        logger.info("Conexión Deepgram iniciada y lista para recibir audio.")

        # --- Bucle Principal ---
        while True:
            try:
                # Recibir mensaje del cliente
                message_raw = await websocket.receive()
                
                # Determinar el tipo de mensaje
                if "type" in message_raw and message_raw["type"] == "websocket.receive":
                    if "text" in message_raw:
                        # Es un mensaje de texto (JSON)
                        try:
                            text_data = message_raw["text"]
                            logger.info(f"Received text message: {text_data}")
                            message = json.loads(text_data)
                            
                            # Si recibimos un comando para detener y analizar
                            if message.get("command") == "stop_and_analyze":
                                logger.info("Received stop_and_analyze command")
                                
                                # Check if transcript was sent directly from frontend
                                client_transcript = message.get("transcript")
                                
                                if client_transcript:
                                    logger.info("Using transcript sent from client")
                                    complete_text = client_transcript
                                    analysis = await generate_analysis(complete_text)
                                    

                                    # Guardar en Excel
                                    try:
                                        filename = f"transcripcion_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
                                        filepath = os.path.join(os.getcwd(), filename)
                                        
                                        # Crear DataFrame y guardar
                                        df = pd.DataFrame({
                                            "Transcripción Completa": [complete_text],
                                            "Resumen": [analysis.get("resumen", "")],
                                            "Puntos Clave": [analysis.get("puntos_clave", "")],
                                            "Sentimiento": [analysis.get("sentimiento", "")],
                                            "Recomendaciones": [analysis.get("recomendaciones", "")]
                                        })
                                        
                                        try:
                                            df.to_excel(filepath, index=False)
                                            file_saved = True
                                        except ModuleNotFoundError:
                                            logger.warning("openpyxl no está instalado. Guardando como CSV en su lugar.")
                                            filepath = filepath.replace('.xlsx', '.csv')
                                            df.to_csv(filepath, index=False)
                                            file_saved = True
                                        
                                        # Enviar ruta del archivo al cliente
                                        await websocket.send_text(json.dumps({
                                            "analysis_complete": True,
                                            "file_path": filepath,
                                            "analysis": analysis
                                        }))
                                        
                                        logger.info(f"Análisis completado y guardado en {filepath}")
                                    except Exception as e:
                                        logger.error(f"Error al guardar el archivo: {e}")
                                        # Enviar solo el análisis sin archivo
                                        await websocket.send_text(json.dumps({
                                            "analysis_complete": True,
                                            "analysis": analysis,
                                            "error_saving": str(e)
                                        }))
                                        logger.info("Análisis completado pero no se pudo guardar el archivo")
                                # If no client transcript, try to use the backend's stored transcript
                                elif full_transcript:
                                    logger.info(f"Analyzing transcript with {len(full_transcript)} segments")
                                    complete_text = " ".join(full_transcript)
                                    logger.info(f"Complete text for analysis: '{complete_text}'")
                                    analysis = await generate_analysis(complete_text)
                                    
                                    # Guardar en Excel
                                    filename = f"transcripcion_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
                                    filepath = os.path.join(os.getcwd(), filename)
                                    
                                    # Crear DataFrame y guardar
                                    df = pd.DataFrame({
                                        "Transcripción Completa": [complete_text],
                                        "Resumen": [analysis.get("resumen", "")],
                                        "Puntos Clave": [analysis.get("puntos_clave", "")],
                                        "Sentimiento": [analysis.get("sentimiento", "")],
                                        "Recomendaciones": [analysis.get("recomendaciones", "")]
                                    })
                                    
                                    df.to_excel(filepath, index=False)
                                    
                                    # Enviar ruta del archivo al cliente
                                    await websocket.send_text(json.dumps({
                                        "analysis_complete": True,
                                        "file_path": filepath,
                                        "analysis": analysis
                                    }))
                                    
                                    logger.info(f"Análisis completado y guardado en {filepath}")
                                else:
                                    logger.warning("No transcript data to analyze")
                                    await websocket.send_text(json.dumps({
                                        "error": "No hay transcripción para analizar"
                                    }))
                        except json.JSONDecodeError as e:
                            logger.error(f"Error al decodificar mensaje JSON del cliente: {e}")
                            logger.error(f"Mensaje recibido: {message_raw}")
                    
                    elif "bytes" in message_raw:
                        # Es un mensaje de bytes (audio)
                        audio_data = message_raw["bytes"]
                        await dg_connection.send(audio_data)
                else:
                    logger.warning(f"Mensaje no reconocido: {message_raw}")
                
            except WebSocketDisconnect:
                logger.info(f"Cliente desconectado: {websocket.client}")
                break
            except Exception as e:
                logger.error(f"Error en el bucle principal: {e}")
                logger.exception("Detalle del error:")  # Esto imprimirá el stack trace completo
                break

    except Exception as e:
        logger.error(f"Error durante la configuración: {e}")
        try:
            await websocket.close(code=1011, reason=f"Error interno: {e}")
        except Exception:
            pass
    finally:
        if dg_connection:
            await dg_connection.finish()
            logger.info("Conexión Deepgram cerrada.")
        logger.info(f"Limpieza completa para cliente: {websocket.client}")

async def generate_analysis(text):
    """Genera análisis de la transcripción usando ChatGPT."""
    try:
        logger.info(f"Generando análisis para texto de {len(text)} caracteres")
        
        # Usar la API de OpenAI correctamente (versión async)
        from openai import AsyncOpenAI
        
        # Inicializar el cliente
        client = AsyncOpenAI(api_key=OPENAI_API_KEY)
        
        # Realizar la solicitud con instrucción específica de no separar oradores
        response = await client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "Eres un asistente especializado en analizar transcripciones de audio. No separes el texto por oradores ni intentes identificar quién habla."},
                {"role": "user", "content": f"Analiza la siguiente transcripción como un texto continuo (NO separes por oradores) y proporciona: 1) Un resumen conciso, 2) Puntos clave, 3) Análisis de sentimiento, 4) Recomendaciones. Transcripción: {text}"}
            ]
        )
        
        analysis_text = response.choices[0].message.content
        logger.info("Análisis generado correctamente")
        
        # Intentar estructurar la respuesta
        analysis = {
            "resumen": "",
            "puntos_clave": "",
            "sentimiento": "",
            "recomendaciones": "",
            "texto_completo": analysis_text
        }
        
        # Extraer secciones (implementación simple)
        sections = analysis_text.split("\n\n")
        if len(sections) >= 4:
            analysis["resumen"] = sections[0].replace("Resumen:", "").strip()
            analysis["puntos_clave"] = sections[1].replace("Puntos clave:", "").strip()
            analysis["sentimiento"] = sections[2].replace("Análisis de sentimiento:", "").strip()
            analysis["recomendaciones"] = sections[3].replace("Recomendaciones:", "").strip()
        
        return analysis
    except Exception as e:
        logger.error(f"Error al generar análisis con ChatGPT: {e}")
        logger.exception("Detalle del error:")
        return {"error": str(e), "texto_completo": text}

@app.get("/")
async def read_root():
    return {"message": "API de Transcripción en Tiempo Real con FastAPI y Deepgram. Conéctate vía WebSocket a /ws/transcribe"}

# --- Para Ejecutar Localmente (opcional) ---
# Se recomienda usar `uvicorn main:app --host 0.0.0.0 --port 8000 --reload`
# if __name__ == "__main__":
#     import uvicorn
#     logger.info("Iniciando servidor Uvicorn...")
#     uvicorn.run(app, host="0.0.0.0", port=8000)