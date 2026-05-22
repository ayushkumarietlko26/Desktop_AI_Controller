# Cloud-Based Desktop Controller Setup Guide

This guide explains how to deploy the Backend to Render and how to run the Local Agent on your PC.

## 1. Deploying the Backend to Render

1. Create a GitHub repository and push this entire project to it.
2. Sign up or log in to [Render](https://render.com).
3. Click **New** and select **Web Service**.
4. Connect your GitHub account and select your repository.
5. Configure the Web Service:
   - **Name**: `desktop-ai-controller` (or any name you like)
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn -k eventlet -w 1 server:app`
6. Click **Create Web Service**.
7. Wait for the deployment to finish. Once done, copy your **Render URL** (e.g., `https://desktop-ai-controller.onrender.com`).

## 2. Deploying the Frontend to Vercel

1. Log in to [Vercel](https://vercel.com).
2. Click **Add New** -> **Project**.
3. Import your GitHub repository.
4. Set the **Root Directory** to `frontend`.
5. Vercel will automatically detect the Vite Framework. Click **Deploy**.
6. Once deployed, open your Vercel site.

## 3. Running the Local Agent on Your PC

To actually control your PC, you must run the local agent.

1. Ensure you have Python installed on your PC.
2. Open a terminal/command prompt.
3. Install the required dependencies:
   ```bash
   pip install -r agent_requirements.txt
   ```
4. Run the local agent:
   ```bash
   python local_agent.py
   ```
5. The agent will prompt you for two things:
   - **Cloud Server URL**: Paste the Render URL you copied in Step 1.
   - **Room ID**: Open your Vercel Frontend link, copy the 6-character Room ID displayed there, and paste it here.

## 4. Usage

1. Open the Vercel Frontend on any device (your phone, a friend's PC, etc.).
2. Ensure the **Server URL** matches your Render URL.
3. Click **Connect**.
4. Click **Start Camera Stream**. The video feed will be sent to the cloud, processed, and commands will be sent seamlessly to your Local Agent!
