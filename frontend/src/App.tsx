import React, { useState, useRef, useEffect, useCallback } from 'react';

const App: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState<string>('');
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [analysis, setAnalysis] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);

  const WS_URL = 'ws://localhost:8000/ws/transcribe';

  // Función para iniciar la conexión WebSocket
  const connectWebSocket = useCallback(() => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected');
      return;
    }

    setConnectionStatus('connecting');
    console.log('Attempting to connect WebSocket...');
    socketRef.current = new WebSocket(WS_URL);

    socketRef.current.onopen = () => {
      console.log('WebSocket Connected');
      setConnectionStatus('connected');
    };

    socketRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        // Si es un mensaje de transcripción
        if (data.transcript !== undefined) {
          if (data.is_final) {
            // Añadir al transcript final
            setTranscript(prev => prev + data.transcript + ' ');
            setInterimTranscript(''); // Limpiar el interim
          } else {
            // Actualizar el transcript provisional
            setInterimTranscript(data.transcript);
          }
        }
        
        // Si es un mensaje de análisis completado
        if (data.analysis_complete) {
          setAnalysis(data.analysis);
          setIsAnalyzing(false);
        }
        
        // Si es un mensaje de error
        if (data.error) {
          console.error('Error from server:', data.error);
          alert(`Error: ${data.error}`);
        }
      } catch (e) {
        console.error('Error parsing message from server:', e, event.data);
      }
    };

    socketRef.current.onerror = (error) => {
      console.error('WebSocket Error:', error);
      setConnectionStatus('error');
    };

    socketRef.current.onclose = (event) => {
      console.log('WebSocket Disconnected:', event.reason, event.code);
      if (isRecording) {
        setConnectionStatus('disconnected');
      }
      socketRef.current = null;
    };
  }, [isRecording]);

  // Función para iniciar la grabación
  const startRecording = async () => {
    // Reset analysis when starting a new recording
    setAnalysis(null);
    
    // --- Inicializar AudioContext en un gesto del usuario ---
    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        await audioContextRef.current.resume();
        console.log("AudioContext started");
      } catch (e) {
        console.error("Error initializing AudioContext:", e);
        alert("Could not initialize audio. Please allow microphone access.");
        return;
      }
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('La API de MediaDevices no es soportada en tu navegador.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      connectWebSocket();

      const checkConnection = setInterval(() => {
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          clearInterval(checkConnection);
          console.log("WebSocket ready, starting MediaRecorder...");

          const options = [
            'audio/webm;codecs=opus',
            'audio/ogg;codecs=opus',
            'audio/wav',
            'audio/mp4',
            'audio/aac',
          ].find(type => MediaRecorder.isTypeSupported(type));

          if (!options) {
            console.error("No suitable MIME type found for MediaRecorder");
            alert("Your browser doesn't support suitable audio recording formats.");
            socketRef.current?.close();
            return;
          }
          console.log(`Using MIME type: ${options}`);

          mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: options });
          audioChunksRef.current = [];

          mediaRecorderRef.current.ondataavailable = (event) => {
            if (event.data.size > 0) {
              if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
                socketRef.current.send(event.data);
              } else {
                console.warn("WebSocket not open, discarding audio chunk.");
              }
            }
          };

          mediaRecorderRef.current.onstop = () => {
            console.log("MediaRecorder stopped.");
            stream.getTracks().forEach(track => track.stop());
            
            // No cerramos el WebSocket aquí si queremos analizar
            if (!isAnalyzing && socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
              console.log("Closing WebSocket connection intentionally.");
              socketRef.current.close();
              socketRef.current = null;
              setConnectionStatus('disconnected');
            }
          };

          mediaRecorderRef.current.start(1000);
          setIsRecording(true);
          setTranscript('');
          setInterimTranscript('');

        } else if (socketRef.current &&
                  (socketRef.current.readyState === WebSocket.CLOSING ||
                   socketRef.current.readyState === WebSocket.CLOSED)) {
          clearInterval(checkConnection);
          console.error("WebSocket connection failed or closed before MediaRecorder could start.");
          setConnectionStatus('error');
        }
      }, 100);

    } catch (err) {
      console.error('Error al acceder al micrófono o iniciar grabación:', err);
      alert('No se pudo acceder al micrófono. Asegúrate de dar permiso.');
      setConnectionStatus('error');
    }
  };

  // Función para detener la grabación
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      // No cerramos el WebSocket aquí para poder enviar comandos después
      // El WebSocket se cerrará automáticamente cuando el componente se desmonte
    }
  };

  // Función para solicitar análisis
  const requestAnalysis = () => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      setIsAnalyzing(true);
      console.log("Enviando comando de análisis al servidor...");
      socketRef.current.send(JSON.stringify({
        command: 'stop_and_analyze',
        transcript: transcript.trim() // Send the transcript directly
      }));
    } else {
      console.error("WebSocket no está abierto:", socketRef.current ? socketRef.current.readyState : "null");
      
      // Si el WebSocket está cerrado, intentar reconectar y luego enviar
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.CONNECTING) {
        console.log("Intentando reconectar WebSocket...");
        connectWebSocket();
        
        // Esperar a que se conecte y luego enviar
        const checkAndSend = setInterval(() => {
          if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
            clearInterval(checkAndSend);
            console.log("WebSocket reconectado, enviando comando de análisis...");
            socketRef.current.send(JSON.stringify({
              command: 'stop_and_analyze',
              transcript: transcript.trim() // Send the transcript directly
            }));
            setIsAnalyzing(true);
          }
        }, 500);
        
        // Timeout después de 5 segundos
        setTimeout(() => {
          clearInterval(checkAndSend);
          if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
            setIsAnalyzing(false);
            alert('No hay conexión con el servidor para analizar la transcripción.');
          }
        }, 5000);
      } else {
        alert('No hay conexión con el servidor para analizar la transcripción.');
      }
    }
  };

  // Limpieza al desmontar el componente
  useEffect(() => {
    return () => {
      stopRecording();
      audioContextRef.current?.close();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
      <h1 className="text-3xl font-bold mb-6 text-blue-600">Transcripción en Tiempo Real</h1>

      <div className="mb-4 flex space-x-4">
        <button
          onClick={isRecording ? stopRecording : startRecording}
          className={`px-6 py-3 rounded-lg font-semibold text-white transition-colors duration-200
                      ${isRecording ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}
          disabled={isAnalyzing}
        >
          {isRecording ? 'Detener Grabación' : 'Iniciar Grabación'}
        </button>

        <button
          onClick={requestAnalysis}
          className={`px-6 py-3 rounded-lg font-semibold text-white transition-colors duration-200
                     ${isAnalyzing ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-500 hover:bg-blue-600'}`}
          disabled={isRecording || isAnalyzing || !transcript.trim()}
        >
          {isAnalyzing ? 'Analizando...' : 'Analizar Transcripción'}
        </button>
      </div>

      <div className="mb-4 text-sm text-gray-600">
        Estado Conexión: <span className={`font-medium ${
          connectionStatus === 'connected' ? 'text-green-600' :
          connectionStatus === 'connecting' ? 'text-yellow-600' :
          'text-red-600'
        }`}>{connectionStatus}</span>
      </div>

      <div className="w-full max-w-2xl bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-xl font-semibold mb-3 text-gray-700">Transcripción:</h2>
        
        {/* Transcripción final */}
        <div
          className="w-full h-48 p-3 border border-gray-300 rounded-md overflow-auto bg-gray-50 text-gray-800 mb-2"
        >
          {transcript}
          {/* Mostrar el texto provisional en un color diferente */}
          {interimTranscript && (
            <span className="text-gray-400">{interimTranscript}</span>
          )}
        </div>
      </div>

      {/* Sección de análisis */}
      {analysis && (
        <div className="w-full max-w-2xl bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold mb-3 text-blue-600">Análisis de la Transcripción:</h2>
          
          <div className="space-y-4">
            <div>
              <h3 className="font-medium text-gray-700">Resumen:</h3>
              <p className="text-gray-600">{analysis.resumen}</p>
            </div>
            
            <div>
              <h3 className="font-medium text-gray-700">Puntos Clave:</h3>
              <p className="text-gray-600">{analysis.puntos_clave}</p>
            </div>
            
            <div>
              <h3 className="font-medium text-gray-700">Sentimiento:</h3>
              <p className="text-gray-600">{analysis.sentimiento}</p>
            </div>
            
            <div>
              <h3 className="font-medium text-gray-700">Recomendaciones:</h3>
              <p className="text-gray-600">{analysis.recomendaciones}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;