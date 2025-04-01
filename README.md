# RTM Transcriptions

Sistema de transcripción y análisis de audio en tiempo real con información basada en IA.

## Descripción general

RTM Transcriptions es una aplicación web que proporciona transcripción y análisis de audio en tiempo real. Captura audio desde tu micrófono, lo transcribe utilizando la API de reconocimiento de voz de Deepgram, y puede analizar el contenido utilizando los modelos de lenguaje de OpenAI para proporcionar resúmenes, puntos clave, análisis de sentimiento y recomendaciones.

## Características

- **Transcripción en tiempo real**: Convierte voz a texto mientras hablas
- **Análisis con IA**: Genera resúmenes, puntos clave, análisis de sentimiento y recomendaciones
- **Exportación a Excel/CSV**: Guarda transcripciones y análisis para consulta posterior
- **Comunicación WebSocket**: Comunicación de baja latencia entre frontend y backend
- **Interfaz responsiva**: Interfaz limpia construida con React y Tailwind CSS

## Tecnologías utilizadas

### Backend
- FastAPI (Framework web de Python)
- Deepgram SDK (Reconocimiento de voz a texto)
- OpenAI API (Análisis de texto)
- WebSockets (Comunicación en tiempo real)
- Pandas (Manejo de datos)

### Frontend
- React 19
- TypeScript
- Tailwind CSS
- API WebSocket

## Primeros pasos

### Requisitos previos

- Python 3.8+
- Node.js 18+
- Clave API de Deepgram
- Clave API de OpenAI

### Instalación

1. Clona el repositorio:
   ```bash
   git clone https://github.com/tuusuario/rtm-transcriptions.git
   cd rtm-transcriptions
