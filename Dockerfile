FROM python:3.10-slim

# Install system dependencies required by OpenCV and Mediapipe
# Note: libgl1-mesa-glx was renamed to libgl1 in Debian Trixie (Debian 13)
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Expose port and start gunicorn
EXPOSE 5000
CMD ["gunicorn", "-k", "geventwebsocket.gunicorn.workers.GeventWebSocketWorker", "-w", "1", "-b", "0.0.0.0:5000", "--timeout", "120", "--keep-alive", "5", "server:app"]