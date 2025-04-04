import React, { useState, useRef, useEffect, useCallback } from 'react';

const App: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState<string>('');
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [analysis, setAnalysis] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  // Add state for model selection and export formats
  const [selectedModel, setSelectedModel] = useState<string>('nova-2');
  const [exportFormats, setExportFormats] = useState({
    excel: true,
    pdf: false,
    word: false
  });

  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Función para iniciar la conexión WebSocket
  const connectWebSocket = useCallback(() => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected');
      return;
    }

    setConnectionStatus('connecting');
    console.log('Attempting to connect WebSocket...');
    
    // Add more debugging information
    console.log('Environment:', import.meta.env.PROD ? 'Production' : 'Development');
    console.log('VITE_BACKEND_URL:', import.meta.env.VITE_BACKEND_URL);
    
    // Try to fetch the backend status first to check connectivity
    fetch(`https://${import.meta.env.VITE_BACKEND_URL.replace(/^https?:\/\//, '')}/docs`)
      .then(response => {
        console.log('Backend docs endpoint response:', response.status);
      })
      .catch(error => {
        console.error('Error checking backend status:', error);
      });
    
    // Modificar la URL del WebSocket para incluir la ruta correcta
    const wsUrl = `wss://${import.meta.env.VITE_BACKEND_URL.replace(/^https?:\/\//, '')}/ws/transcribe`;
    
    console.log('Connecting to WebSocket URL:', wsUrl);
    
    try {
      socketRef.current = new WebSocket(wsUrl);
      
      socketRef.current.onopen = () => {
        console.log('WebSocket Connected');
        setConnectionStatus('connected');
        
        // Send model configuration when connection is established
        if (socketRef.current) {
          socketRef.current.send(JSON.stringify({
            model: selectedModel
          }));
          console.log(`Sent model configuration: ${selectedModel}`);
        }
      };

      // Fix: Add null check for socketRef.current
      if (socketRef.current) {
        socketRef.current.onmessage = async (event) => {
          try {
            // Check if it's a text message (JSON)
            if (typeof event.data === 'string') {
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
                
                // If file_path is present, create download link
                if (data.file_path) {
                  console.log('Received file path:', data.file_path);
                  
                  // Create a download link for the file
                  const fileUrl = `https://${import.meta.env.VITE_BACKEND_URL.replace(/^https?:\/\//, '')}/download?path=${encodeURIComponent(data.file_path)}`;
                  console.log('Download URL:', fileUrl);
                  
                  // Create and trigger download
                  const a = document.createElement('a');
                  a.href = fileUrl;
                  a.download = data.file_path.split('/').pop() || 'analysis.xlsx';
                  document.body.appendChild(a);
                  a.click();
                  
                  // Clean up
                  setTimeout(() => {
                    document.body.removeChild(a);
                  }, 100);
                }
                
                // If file_data is present, prepare for file downloads
                if (data.file_data) {
                  console.log('Received file metadata:', data.file_data);
                  // Store file metadata for later download when binary data arrives
                  window.fileMetadata = data.file_data;
                }
              }
              
              // Si es un mensaje de error
              if (data.error) {
                console.error('Error from server:', data.error);
                alert(`Error: ${data.error}`);
              }
            } 
            // Handle binary data (file downloads)
            else if (event.data instanceof Blob) {
              console.log('Received binary data for file download', event.data.size, 'bytes');
              
              // Debug the blob content type
              console.log('Blob type:', event.data.type);
              
              try {
                // First, try to parse the first few bytes to see if it's actually JSON
                const firstChunk = await event.data.slice(0, 100).text();
                if (firstChunk.trim().startsWith('{')) {
                  // It's probably JSON, not a binary file
                  const fullText = await event.data.text();
                  console.log('Received JSON in binary format:', fullText.substring(0, 200) + '...');
                  try {
                    const jsonData = JSON.parse(fullText);
                    if (jsonData.error) {
                      console.error('Error from server:', jsonData.error);
                      alert(`Error: ${jsonData.error}`);
                    }
                  } catch (e) {
                    console.error('Failed to parse JSON from blob:', e);
                  }
                  return;
                }
              } catch (e) {
                console.log('Not JSON data, proceeding with binary download');
              }
              
              // Get the format from the selected formats
              const selectedFormats = Object.entries(exportFormats)
                .filter(([_, selected]) => selected)
                .map(([format]) => format);
              
              // Map format to file extension and MIME type
              const formatMap = {
                excel: { ext: 'xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
                pdf: { ext: 'pdf', type: 'application/pdf' },
                word: { ext: 'docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
              };
              
              // Try to determine file type from the blob or use the first selected format
              let fileExtension = 'bin';
              let contentType = event.data.type || 'application/octet-stream';
              
              // If the content type is generic, use the first selected format
              if (contentType === 'application/octet-stream' && selectedFormats.length > 0) {
                const format = selectedFormats[0];
                if (formatMap[format as keyof typeof formatMap]) {
                  fileExtension = formatMap[format as keyof typeof formatMap].ext;
                  contentType = formatMap[format as keyof typeof formatMap].type;
                  console.log(`Using format from selection: ${format} -> ${fileExtension}`);
                }
              } else {
                // Try to determine from content type
                if (contentType.includes('excel') || contentType.includes('spreadsheetml')) {
                  fileExtension = 'xlsx';
                } else if (contentType.includes('pdf')) {
                  fileExtension = 'pdf';
                } else if (contentType.includes('word') || contentType.includes('document')) {
                  fileExtension = 'docx';
                }
              }
              
              // Create a filename based on timestamp and detected type
              const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
              const filename = `analysis_${timestamp}.${fileExtension}`;
              
              console.log(`Downloading file as ${filename} with content type ${contentType}`);
              
              // Create download link with the correct content type
              const blob = new Blob([event.data], { type: contentType });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = filename;
              document.body.appendChild(a);
              a.click();
              
              // Clean up
              setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              }, 100);
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
      }
    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
      setConnectionStatus('error');
    }
  }, [isRecording, selectedModel]); // Add selectedModel to dependencies

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
      
      // Get selected export formats as an array
      const selectedFormats = Object.entries(exportFormats)
        .filter(([_, selected]) => selected)
        .map(([format]) => format);
      
      console.log("Selected export formats:", selectedFormats);
      
      // Make sure at least one format is selected
      if (selectedFormats.length === 0) {
        alert('Por favor selecciona al menos un formato de exportación');
        setIsAnalyzing(false);
        return;
      }
      
      // Create a unique session ID for this analysis
      const sessionId = `session_${Date.now()}`;
      
      // Map format to expected MIME types for the server
      const formatMimeTypes = {
        excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        pdf: 'application/pdf',
        word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      };
      
      // Create format details object with proper typing
      const formatDetails: Record<string, { mime_type: string }> = {};
      selectedFormats.forEach(format => {
        if (format in formatMimeTypes) {
          formatDetails[format] = {
            mime_type: formatMimeTypes[format as keyof typeof formatMimeTypes]
          };
        }
      });
      
      socketRef.current.send(JSON.stringify({
        command: 'stop_and_analyze',
        transcript: transcript.trim(),
        export_formats: selectedFormats,
        format_details: formatDetails,
        session_id: sessionId,
        download_mode: 'binary' // Explicitly request binary download
      }));
      
      console.log(`Sent analysis request with session ID: ${sessionId}`);
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
            
            // Get selected export formats as an array
            const selectedFormats = Object.entries(exportFormats)
              .filter(([_, selected]) => selected)
              .map(([format]) => format);
            
            socketRef.current.send(JSON.stringify({
              command: 'stop_and_analyze',
              transcript: transcript.trim(), // Send the transcript directly
              export_formats: selectedFormats
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
    <div className="flex flex-col justify-center items-center p-4 min-h-screen bg-gray-100">
      <h1 className="mb-6 text-3xl font-bold text-blue-600">Transcripción en Tiempo Real</h1>

      {/* Model selection dropdown */}
      <div className="mb-4 w-full max-w-2xl">
        <label className="block mb-1 text-sm font-medium text-gray-700">
          Modelo de Deepgram:
        </label>
        <select
          className="p-2 w-full bg-white rounded-md border border-gray-300 shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          disabled={isRecording}
        >
          <option value="nova-2">Nova-2 (Conversación 2 personas)</option>
          <option value="nova-2-general">Nova-2-General</option>
          <option value="nova-2-meeting">Nova-2-Meeting (Reuniones)</option>
          <option value="nova-2-phonecall">Nova-2-Phonecall (Llamadas)</option>
        </select>
      </div>

      <div className="flex mb-4 space-x-4">
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

      {/* Export format selection */}
      <div className="p-4 mb-4 w-full max-w-2xl bg-white rounded-lg shadow-sm">
        <label className="block mb-2 text-sm font-medium text-gray-700">
          Formatos de exportación:
        </label>
        <div className="flex flex-wrap gap-4">
          <label className="inline-flex items-center">
            <input
              type="checkbox"
              className="w-5 h-5 text-blue-600 form-checkbox"
              checked={exportFormats.excel}
              onChange={() => setExportFormats({...exportFormats, excel: !exportFormats.excel})}
              disabled={isAnalyzing}
            />
            <span className="ml-2 text-gray-700">Excel</span>
          </label>
          <label className="inline-flex items-center">
            <input
              type="checkbox"
              className="w-5 h-5 text-blue-600 form-checkbox"
              checked={exportFormats.pdf}
              onChange={() => setExportFormats({...exportFormats, pdf: !exportFormats.pdf})}
              disabled={isAnalyzing}
            />
            <span className="ml-2 text-gray-700">PDF</span>
          </label>
          <label className="inline-flex items-center">
            <input
              type="checkbox"
              className="w-5 h-5 text-blue-600 form-checkbox"
              checked={exportFormats.word}
              onChange={() => setExportFormats({...exportFormats, word: !exportFormats.word})}
              disabled={isAnalyzing}
            />
            <span className="ml-2 text-gray-700">Word</span>
          </label>
        </div>
      </div>

      <div className="mb-4 text-sm text-gray-600">
        Estado Conexión: <span className={`font-medium ${
          connectionStatus === 'connected' ? 'text-green-600' :
          connectionStatus === 'connecting' ? 'text-yellow-600' :
          'text-red-600'
        }`}>{connectionStatus}</span>
      </div>

      <div className="p-6 mb-6 w-full max-w-2xl bg-white rounded-lg shadow-md">
        <h2 className="mb-3 text-xl font-semibold text-gray-700">Transcripción:</h2>
        
        {/* Transcripción final */}
        <div
          className="overflow-auto p-3 mb-2 w-full h-48 text-gray-800 bg-gray-50 rounded-md border border-gray-300"
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
        <div className="p-6 w-full max-w-2xl bg-white rounded-lg shadow-md">
          <h2 className="mb-3 text-xl font-semibold text-blue-500">Análisis de la Transcripción:</h2>
          
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
