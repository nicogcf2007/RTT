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
- React 19 (con Vite)
- TypeScript
- Tailwind CSS
- API WebSocket

## Primeros pasos

### Requisitos previos

- Python 3.8+
- Node.js 18+ y npm (o yarn/pnpm)
- Clave API de Deepgram
- Clave API de OpenAI

### Instalación

1.  **Clona el repositorio:**
    ```bash
    git clone https://github.com/tuusuario/rtm-transcriptions.git
    cd rtm-transcriptions
    ```

2.  **Configuración del Backend (FastAPI):**
    *   Navega al directorio del backend (asumiendo `backend`):
        ```bash
        cd backend
        ```
    *   Crea y activa un entorno virtual:
        ```bash
        python -m venv venv
        # En Windows: venv\Scripts\activate
        # En macOS/Linux: source venv/bin/activate
        ```
    *   Instala las dependencias de Python:
        ```bash
        pip install -r requirements.txt
        ```
    *   Configura las variables de entorno. Crea un archivo `.env` en este directorio (puedes copiarlo de `.env.example` si existe) y añade tus claves API:
        ```env
        DEEPGRAM_API_KEY=TU_CLAVE_DEEPGRAM
        OPENAI_API_KEY=TU_CLAVE_OPENAI
        ```

3.  **Configuración del Frontend (React + Vite):**
    *   Navega al directorio del frontend (asumiendo `frontend`):
        ```bash
        # Si estás en backend/: cd ../frontend
        # Si estás en la raíz: cd frontend
        cd ../frontend
        ```
    *   Instala las dependencias de Node.js:
        ```bash
        npm install
        ```
    *   Configura las variables de entorno del frontend. Crea un archivo `.env.local` en el directorio `frontend` (puedes basarte en un archivo `.env.example` si existe). Asegúrate de incluir la variable de entorno que especifica la URL de tu servidor backend (por ejemplo, `VITE_BACKEND_URL=http://localhost:8000`). Consulta la documentación de Vite o el código fuente del frontend para el nombre exacto de la variable requerida.

### Ejecución

Necesitarás ejecutar tanto el servidor backend como el servidor de desarrollo del frontend en terminales separadas.

1.  **Iniciar el Backend:**
    *   Desde el directorio `backend` (con el entorno virtual activado):
        ```bash
        uvicorn main:app --reload --port 8000
        ```

2.  **Iniciar el Frontend:**
    *   Desde el directorio `frontend`:
        ```bash
        npm run dev
        ```

3.  **Acceso:**
    *   Abre tu navegador y ve a la dirección que indica el servidor de desarrollo de Vite (normalmente `http://localhost:5173`).
