import React, { useState, useRef, useEffect, useCallback } from 'react';


const App: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState<string>('');
  const [interimTranscript, setInterimTranscript] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [analysis, setAnalysis] = useState<any>(null); // Consider defining a stricter type later
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>('nova-2');
  const [exportFormats, setExportFormats] = useState({
    excel: true,
    pdf: false,
    word: false
  });

  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  // No need to store audio chunks if sending directly via WebSocket
  // const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);

  // --- WebSocket Connection Logic (Mostly unchanged, added comments) ---
  const connectWebSocket = useCallback(() => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected');
      return;
    }

    setConnectionStatus('connecting');
    console.log('Attempting to connect WebSocket...');
    console.log('Environment:', import.meta.env.PROD ? 'Production' : 'Development');
    console.log('VITE_BACKEND_URL:', import.meta.env.VITE_BACKEND_URL);

    // Check backend connectivity (optional but helpful for debugging)
    fetch(`https://${import.meta.env.VITE_BACKEND_URL.replace(/^https?:\/\//, '')}/docs`)
      .then(response => {
        console.log('Backend docs endpoint response status:', response.status);
      })
      .catch(error => {
        console.error('Error checking backend status:', error);
      });

    const wsUrl = `wss://${import.meta.env.VITE_BACKEND_URL.replace(/^https?:\/\//, '')}/ws/transcribe`;
    console.log('Connecting to WebSocket URL:', wsUrl);

    try {
      socketRef.current = new WebSocket(wsUrl);

      socketRef.current.onopen = () => {
        console.log('WebSocket Connected');
        setConnectionStatus('connected');
        // Send model configuration
        if (socketRef.current) {
            socketRef.current.send(JSON.stringify({ model: selectedModel }));
            console.log(`Sent model configuration: ${selectedModel}`);
        }
      };

      if (socketRef.current) {
        socketRef.current.onmessage = async (event) => {
           try {
            // Handle Text Messages (JSON)
            if (typeof event.data === 'string') {
              const data = JSON.parse(event.data);
              console.log("Received JSON data:", data); // Log all incoming JSON

              // Transcription updates
              if (data.transcript !== undefined) {
                if (data.is_final) {
                  setTranscript(prev => prev + data.transcript + ' ');
                  setInterimTranscript('');
                } else {
                  setInterimTranscript(data.transcript);
                }
              }

              // Analysis completion
              if (data.analysis_complete) {
                setAnalysis(data.analysis);
                setIsAnalyzing(false);
                // If file_path is present (older download method, keep for compatibility if needed)
                if (data.file_path) {
                    console.warn('Received file_path (older method):', data.file_path);
                    // ... (existing file_path download logic)
                }
                // Store file metadata for subsequent binary downloads
                if (data.file_data) {
                    console.log('Received file metadata:', data.file_data);
                    window.fileMetadata = data.file_data;
                    window.downloadCounter = 0; // Reset counter when new metadata arrives
                }
              }

              // Server errors
              if (data.error) {
                console.error('Error from server:', data.error);
                alert(`Server Error: ${data.error}`);
                // Potentially reset states if error is critical
                setIsAnalyzing(false);
              }
            }
            // Handle Binary Data (File Downloads)
            else if (event.data instanceof Blob) {
              console.log('Received binary data (Blob)', event.data.size, 'bytes, type:', event.data.type);

               // Check if it's unexpectedly small JSON in binary format (less likely now but safe check)
              if (event.data.size < 500 && (event.data.type === 'application/json' || event.data.type === '')) {
                  try {
                      const textData = await event.data.text();
                      const jsonData = JSON.parse(textData);
                      if (jsonData.error) {
                          console.error('Error from server (in Blob):', jsonData.error);
                          alert(`Server Error: ${jsonData.error}`);
                      } else {
                          console.warn('Received unexpected JSON in Blob:', jsonData);
                      }
                      return; // Don't process as file
                  } catch (e) {
                      // Not JSON, likely a small file, proceed
                      console.log('Blob is not JSON, proceeding with file download.');
                  }
              }


              const formatMap: Record<string, { ext: string; type: string }> = {
                excel: { ext: 'xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
                pdf: { ext: 'pdf', type: 'application/pdf' },
                word: { ext: 'docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }
              };

              let filename = `analysis_${new Date().toISOString().replace(/[:.]/g, '-')}.bin`;
              let contentType = event.data.type || 'application/octet-stream'; // Use blob type first

              // Use metadata if available
              if (window.fileMetadata) {
                  const availableFormats = Object.keys(window.fileMetadata);
                  if (window.downloadCounter === undefined) window.downloadCounter = 0;

                  if (window.downloadCounter < availableFormats.length) {
                      const formatKey = availableFormats[window.downloadCounter];
                      const fileDetails = window.fileMetadata[formatKey];
                      if (fileDetails) {
                          filename = fileDetails.filename; // Use server-provided filename
                          contentType = fileDetails.content_type; // Use server-provided content type
                          console.log(`Using metadata for ${formatKey}: filename=${filename}, type=${contentType}`);
                      } else {
                           console.warn(`Metadata missing details for format key: ${formatKey}`);
                      }
                      window.downloadCounter++;
                  } else {
                      console.warn('Download counter exceeded available formats in metadata.');
                  }

                  // Clean up metadata if all files are processed
                  if (window.downloadCounter >= availableFormats.length) {
                      window.fileMetadata = null;
                       window.downloadCounter = 0;
                      console.log("Cleared file metadata after processing all files.");
                  }
              } else {
                  console.warn('No file metadata available for binary download, attempting fallback detection.');
                  // Fallback: Try to guess based on selected formats or Blob type (less reliable)
                  const selectedFormats = Object.entries(exportFormats)
                    .filter(([_, selected]) => selected)
                    .map(([format]) => format);

                  let guessedFormat = '';
                  if (contentType.includes('spreadsheetml') || contentType.includes('excel')) guessedFormat = 'excel';
                  else if (contentType.includes('pdf')) guessedFormat = 'pdf';
                  else if (contentType.includes('wordprocessingml') || contentType.includes('word')) guessedFormat = 'word';

                  // If type is generic, use the first selected format as a guess
                  if (guessedFormat === '' && contentType === 'application/octet-stream' && selectedFormats.length > 0) {
                      guessedFormat = selectedFormats[0];
                  }

                  if (guessedFormat && formatMap[guessedFormat]) {
                      filename = `analysis_${new Date().toISOString().replace(/[:.]/g, '-')}.${formatMap[guessedFormat].ext}`;
                      // Don't override contentType if it was specific from the Blob
                      if (contentType === 'application/octet-stream') {
                          contentType = formatMap[guessedFormat].type;
                      }
                      console.log(`Fallback guess: format=${guessedFormat}, filename=${filename}, type=${contentType}`);
                  }
              }

              // Create download link
              console.log(`Triggering download: Filename='${filename}', Content-Type='${contentType}'`);
              const blob = new Blob([event.data], { type: contentType }); // Ensure correct type is set
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

            } else {
               console.warn("Received unexpected message type:", typeof event.data, event.data);
            }
          } catch (e) {
            console.error('Error processing message from server:', e, event.data);
          }
        };

        socketRef.current.onerror = (error) => {
          console.error('WebSocket Error:', error);
          setConnectionStatus('error');
          setIsAnalyzing(false); // Stop analysis on error
        };

        socketRef.current.onclose = (event) => {
          console.log('WebSocket Disconnected:', event.reason, event.code);
          // Only set to disconnected if not intentionally closed after analysis
          if (connectionStatus !== 'disconnected') {
              setConnectionStatus('disconnected');
          }
          socketRef.current = null;
          // Don't automatically stop analysis here, might be closed after sending command
          // setIsAnalyzing(false);
        };
      }
    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
      setConnectionStatus('error');
    }
  }, [selectedModel, connectionStatus, exportFormats]); // Added dependencies

  // --- Audio Recording Logic ---
  const startRecording = async () => {
    setAnalysis(null); // Clear previous analysis
    setTranscript(''); // Clear previous transcript
    setInterimTranscript('');

    // Initialize AudioContext on user gesture
    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        await audioContextRef.current.resume();
        console.log("AudioContext started/resumed");
      } catch (e) {
        console.error("Error initializing AudioContext:", e);
        alert("Could not initialize audio. Please allow microphone access and try again.");
        return;
      }
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert('Your browser does not support the MediaDevices API.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      connectWebSocket(); // Initiate WebSocket connection

      // Wait for WebSocket to be open before starting MediaRecorder
      const checkConnectionAndStart = setInterval(() => {
        if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
          clearInterval(checkConnectionAndStart);
          console.log("WebSocket ready, starting MediaRecorder...");

          // Find supported MIME type
           const optionsList = [
                'audio/webm;codecs=opus', // Preferred
                'audio/ogg;codecs=opus',
                'audio/wav',
                'audio/webm', // Generic webm
                'audio/mp4', // Sometimes supported
            ];
           const mimeType = optionsList.find(type => MediaRecorder.isTypeSupported(type));


          if (!mimeType) {
            console.error("No suitable MIME type found for MediaRecorder.");
            alert("Your browser doesn't support suitable audio recording formats (like WebM/Opus or WAV).");
            socketRef.current?.close(); // Close socket if recording can't start
            setConnectionStatus('error');
            return;
          }
          console.log(`Using MIME type: ${mimeType}`);

          mediaRecorderRef.current = new MediaRecorder(stream, { mimeType });

          mediaRecorderRef.current.ondataavailable = (event) => {
            if (event.data.size > 0 && socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
              socketRef.current.send(event.data);
            } else if (event.data.size > 0) {
               console.warn("WebSocket not open or ready, discarding audio chunk.");
               // Optional: Buffer chunks locally if needed, but increases complexity
            }
          };

          mediaRecorderRef.current.onstop = () => {
            console.log("MediaRecorder stopped.");
            stream.getTracks().forEach(track => track.stop()); // Stop microphone access
            // WebSocket is kept open for analysis command
             if (socketRef.current && socketRef.current.readyState !== WebSocket.OPEN && !isAnalyzing) {
                // If socket closed unexpectedly before analysis command
                setConnectionStatus('disconnected');
            }
          };

          mediaRecorderRef.current.start(1000); // Send data chunks every second
          setIsRecording(true);

        } else if (socketRef.current &&
                  (socketRef.current.readyState === WebSocket.CLOSING ||
                   socketRef.current.readyState === WebSocket.CLOSED)) {
          clearInterval(checkConnectionAndStart);
          console.error("WebSocket connection failed or closed before MediaRecorder could start.");
          setConnectionStatus('error');
          alert("Connection to server failed. Please try again.");
        } else {
            console.log("Waiting for WebSocket connection..."); // Log waiting status
        }
      }, 200); // Check every 200ms

      // Timeout for waiting connection
       setTimeout(() => {
            if (!isRecording && connectionStatus === 'connecting') { // Check if still connecting and not recording
                clearInterval(checkConnectionAndStart);
                setConnectionStatus('error');
                alert("Connection timed out. Please check your network or server status.");
            }
        }, 10000); // 10 second timeout


    } catch (err: any) { // Catch specific error types if needed
      console.error('Error accessing microphone or starting recording:', err);
       if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            alert('Microphone access denied. Please grant permission in your browser settings.');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            alert('No microphone found. Please ensure a microphone is connected and enabled.');
        }
      else {
        alert('Could not access microphone. Please ensure it is connected and permission is granted.');
      }
      setConnectionStatus('error'); // Set error state if mic access fails
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      console.log("Stopping MediaRecorder...");
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      // Keep the WebSocket open, analysis might be requested next.
       // The onstop handler will manage stream tracks.
    }
  };

  // --- Analysis Request Logic ---
  const requestAnalysis = () => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
       if (!transcript.trim()) {
            alert("No transcription available to analyze.");
            return;
        }

      setIsAnalyzing(true);
      setAnalysis(null); // Clear previous analysis results display
      console.log("Sending analysis command to server...");

      const selectedFormats = Object.entries(exportFormats)
        .filter(([_, selected]) => selected)
        .map(([format]) => format);

      if (selectedFormats.length === 0) {
        alert('Please select at least one export format.');
        setIsAnalyzing(false);
        return;
      }

      // Map format to expected MIME types for the server
      const formatMimeTypes: Record<string, string> = {
        excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        pdf: 'application/pdf',
        word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      };

      const formatDetails: Record<string, { mime_type: string }> = {};
      selectedFormats.forEach(format => {
        if (format in formatMimeTypes) {
          formatDetails[format] = { mime_type: formatMimeTypes[format] };
        }
      });

      const analysisPayload = {
        command: 'stop_and_analyze',
        transcript: transcript.trim(),
        export_formats: selectedFormats,
        format_details: formatDetails, // Send expected MIME types
        download_mode: 'binary' // Explicitly request binary download
      };

      console.log("Sending analysis payload:", analysisPayload);
      socketRef.current.send(JSON.stringify(analysisPayload));

    } else {
      console.error("Cannot analyze: WebSocket is not open. State:", socketRef.current?.readyState);
      alert('Connection to server lost. Please try recording again.');
       setIsAnalyzing(false); // Ensure analyzing state is reset
       setConnectionStatus('disconnected'); // Update status
    }
  };

  // --- Cleanup Effect ---
  useEffect(() => {
    return () => {
      // Ensure recording is stopped and resources released on unmount
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current?.stream?.getTracks().forEach(track => track.stop());
      socketRef.current?.close();
      audioContextRef.current?.close();
      console.log("Component unmounted, cleaned up resources.");
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency array ensures this runs only on unmount

  // --- Helper for Connection Status Styling ---
   const getStatusColor = () => {
        switch (connectionStatus) {
            case 'connected': return 'text-green-600';
            case 'connecting': return 'text-yellow-500';
            case 'error': return 'text-red-600';
            case 'disconnected': return 'text-gray-500';
            default: return 'text-gray-500';
        }
    };


 // --- JSX Structure ---
  return (
    <div className="flex flex-col items-center p-4 min-h-screen bg-slate-100 sm:p-8">
      <div className="space-y-8 w-full max-w-4xl"> {/* Increased max-width and spacing */}

        {/* Header */}
        <header className="text-center">
          <h1 className="text-3xl font-bold tracking-tight text-slate-800 sm:text-4xl">
            Transcripción y Análisis en Tiempo Real
          </h1>
           <p className="mt-2 text-base text-slate-600">
             Powered by Deepgram & AI
           </p>
        </header>

        {/* Controls Section */}
        <section className="p-6 bg-white rounded-lg shadow-lg">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">

            {/* Model Selection */}
            <div>
              <label htmlFor="model-select" className="block mb-1 text-sm font-medium text-slate-700">
                Modelo de Transcripción
              </label>
              <select
                id="model-select"
                className="block p-2 w-full rounded-md border shadow-sm border-slate-300 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-70 disabled:bg-slate-50"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                disabled={isRecording || isAnalyzing}
              >
                <option value="nova-2">Nova-2 (Conversación)</option>
                <option value="nova-2-general">Nova-2-General</option>
                <option value="nova-2-meeting">Nova-2-Meeting</option>
                <option value="nova-2-phonecall">Nova-2-Phonecall</option>
                 {/* Add more models as needed */}
              </select>
               <p className="mt-1 text-xs text-slate-500">Selecciona el modelo más adecuado.</p>
            </div>

            {/* Export Formats */}
            <div>
               <label className="block mb-2 text-sm font-medium text-slate-700">
                 Formatos de Exportación del Análisis
               </label>
               <div className="flex flex-wrap gap-y-2 gap-x-6 items-center">
                  <label className="inline-flex items-center">
                    <input
                      type="checkbox"
                      className="w-5 h-5 text-indigo-600 rounded form-checkbox focus:ring-indigo-500 disabled:opacity-70"
                      checked={exportFormats.excel}
                      onChange={() => setExportFormats({...exportFormats, excel: !exportFormats.excel})}
                      disabled={isAnalyzing}
                    />
                    <span className="ml-2 text-sm text-slate-700">Excel (.xlsx)</span>
                  </label>
                  <label className="inline-flex items-center">
                    <input
                      type="checkbox"
                      className="w-5 h-5 text-indigo-600 rounded form-checkbox focus:ring-indigo-500 disabled:opacity-70"
                      checked={exportFormats.pdf}
                      onChange={() => setExportFormats({...exportFormats, pdf: !exportFormats.pdf})}
                      disabled={isAnalyzing}
                    />
                    <span className="ml-2 text-sm text-slate-700">PDF (.pdf)</span>
                  </label>
                  <label className="inline-flex items-center">
                    <input
                      type="checkbox"
                      className="w-5 h-5 text-indigo-600 rounded form-checkbox focus:ring-indigo-500 disabled:opacity-70"
                      checked={exportFormats.word}
                      onChange={() => setExportFormats({...exportFormats, word: !exportFormats.word})}
                      disabled={isAnalyzing}
                    />
                    <span className="ml-2 text-sm text-slate-700">Word (.docx)</span>
                  </label>
               </div>
            </div>
          </div>

           {/* Action Buttons & Status */}
           <div className="flex flex-col items-center mt-6 space-y-4 sm:flex-row sm:justify-center sm:space-y-0 sm:space-x-4">
              <button
                onClick={isRecording ? stopRecording : startRecording}
                className={`inline-flex items-center justify-center px-6 py-3 text-base font-medium text-white border border-transparent rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150
                            ${isRecording
                              ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                              : 'bg-green-600 hover:bg-green-700 focus:ring-green-500'}`}
                disabled={isAnalyzing || connectionStatus === 'connecting'} // Disable while connecting too
              >
                {isRecording ? 'Detener Grabación' : 'Iniciar Grabación'}
              </button>

              <button
                onClick={requestAnalysis}
                className="inline-flex justify-center items-center px-6 py-3 text-base font-medium text-white bg-indigo-600 rounded-md border border-transparent shadow-sm transition-colors duration-150 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={isRecording || isAnalyzing || !transcript.trim() || connectionStatus !== 'connected'}
              >
                 {isAnalyzing && (
                     <svg className="mr-2 -ml-1 w-5 h-5 text-white animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                 )}
                {isAnalyzing ? 'Analizando...' : 'Analizar Transcripción'}
              </button>
           </div>
            <div className="mt-4 text-sm text-center text-slate-600">
                Estado Conexión: <span className={`font-medium ${getStatusColor()}`}>{connectionStatus}</span>
            </div>
        </section>

        {/* Transcription Display Section */}
        <section className="p-6 bg-white rounded-lg shadow-lg">
          <h2 className="mb-3 text-xl font-semibold text-slate-700">Transcripción</h2>
          <div
            className="w-full p-4 overflow-auto border rounded-md min-h-[12rem] bg-slate-50 border-slate-200 text-slate-800 leading-relaxed" // Improved readability
            aria-live="polite" // Announce updates to screen readers
          >
            {transcript || (!isRecording && !transcript)
             ? <span className={!transcript ? "italic text-slate-400" : ""}>
                  {transcript || "La transcripción aparecerá aquí..."}
               </span>
             : transcript}
            {interimTranscript && (
              <span className="text-slate-500"> {interimTranscript}</span> // Added space before interim
            )}
          </div>
        </section>

        {/* Analysis Results Section */}
        {isAnalyzing && !analysis && ( // Show loading state for analysis
             <section className="p-6 text-center bg-white rounded-lg shadow-lg">
                  <div className="flex justify-center items-center">
                    <svg className="mr-3 w-8 h-8 text-indigo-600 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <p className="text-lg font-medium text-slate-700">Generando análisis...</p>
                  </div>
             </section>
        )}

        {analysis && (
          <section className="p-6 bg-white rounded-lg shadow-lg">
            <h2 className="mb-4 text-xl font-semibold text-indigo-700">Análisis de la Transcripción</h2>
            {/* Using prose for better default text styling, remove if causing issues */}
            <div className="space-y-5 max-w-none prose prose-slate">
              {analysis.resumen && (
                 <div>
                    <h3 className="font-semibold text-slate-800 !mt-0 !mb-1">Resumen</h3>
                    <p className="text-slate-600 !mt-0">{analysis.resumen}</p>
                 </div>
              )}
               {analysis.puntos_clave && (
                 <div>
                    <h3 className="font-semibold text-slate-800 !mb-1">Puntos Clave</h3>
                     {/* Render as list if it's an array, otherwise as paragraph */}
                     {Array.isArray(analysis.puntos_clave) ? (
                         <ul className="pl-5 list-disc text-slate-600">
                             {analysis.puntos_clave.map((punto: string, index: number) => <li key={index}>{punto}</li>)}
                         </ul>
                     ) : (
                         <p className="text-slate-600 !mt-0">{analysis.puntos_clave}</p>
                     )}
                 </div>
                )}
               {analysis.sentimiento && (
                  <div>
                    <h3 className="font-semibold text-slate-800 !mb-1">Sentimiento General</h3>
                    <p className="text-slate-600 !mt-0">{analysis.sentimiento}</p>
                  </div>
                )}
               {analysis.recomendaciones && (
                 <div>
                    <h3 className="font-semibold text-slate-800 !mb-1">Recomendaciones / Acciones</h3>
                    {Array.isArray(analysis.recomendaciones) ? (
                         <ul className="pl-5 list-disc text-slate-600">
                             {analysis.recomendaciones.map((rec: string, index: number) => <li key={index}>{rec}</li>)}
                         </ul>
                     ) : (
                         <p className="text-slate-600 !mt-0">{analysis.recomendaciones}</p>
                     )}
                 </div>
                )}
              {/* Add more analysis fields as needed */}
            </div>
          </section>
        )}

      </div> {/* End max-w-4xl wrapper */}
    </div> // End main container
  );
};

export default App;
