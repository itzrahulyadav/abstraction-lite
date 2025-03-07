#!/usr/bin/env node
import { WebSocketServer } from 'ws';
import { ECSClient, ExecuteCommandCommand } from '@aws-sdk/client-ecs';
import { spawn } from 'child_process';
import http from 'http'; // Add HTTP module

const ecsClient = new ECSClient({ region: 'ap-south-1' });

// Create HTTP server for health checks
const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

// Start HTTP server on port 8080
httpServer.listen(8080, () => {
  console.log('HTTP server running on port 8080 for health checks');
});

// Create WebSocket server, sharing the same port
const wss = new WebSocketServer({ server: httpServer });
console.log('WebSocket server running on port 8080');

wss.on('connection', (ws) => {
  console.log('Client connected');
  let sessionProcess = null;
  let taskArn = null;
  let clusterArn = null;

  // CHANGE: Modified waitWithCountdown to show percentage in a single line
  const waitWithCountdown = (seconds) => {
    return new Promise((resolve) => {
      let remaining = seconds;
      const totalSeconds = seconds;
      const interval = setInterval(() => {
        if (remaining >= 0) { // Changed to >= to include 0% at the start
          const percentage = Math.round(((totalSeconds - remaining) / totalSeconds) * 100);
          ws.send(`\rLoaded ${percentage}%`); // \r overwrites the previous line
          console.log(`\rLoaded ${percentage}%`); // Same for backend console
          remaining--;
        } else {
          clearInterval(interval);
          ws.send('\r Connected \r\n'); // Move to new line after completion
          console.log('Countdown complete, executing command');
          resolve();
        }
      }, 1000);
    });
  };

  ws.on('message', async (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
      console.log('Received message:', data);
    } catch (error) {
      console.error('Failed to parse message:', error);
      ws.send('Error: Invalid message format\r\n$ ');
      return;
    }

    if (data.taskArn && !sessionProcess) {
      try {
        taskArn = data.taskArn;
        clusterArn = data.clusterArn || 'default';
        console.log('Starting ECS Exec session with:', { taskArn, clusterArn });

        ws.send('Trying to connect ...\r\n');
        await waitWithCountdown(45);

        const command = new ExecuteCommandCommand({
          cluster: clusterArn,
          task: taskArn,
          interactive: true,
          command: '/bin/sh -c "stty -echo; /bin/sh"',
        });

        const response = await ecsClient.send(command);
        console.log('ECS response:', JSON.stringify(response, null, 2));

        if (response.session) {
          const sessionArgs = [
            JSON.stringify(response.session),
            'ap-south-1',
            'StartSession',
          ];

          sessionProcess = spawn('session-manager-plugin', sessionArgs, {
            stdio: ['pipe', 'pipe', 'pipe'],
          });

          sessionProcess.on('error', (err) => {
            console.error('Spawn error:', err);
            ws.send(`Error spawning session: ${err.message}\r\n$ `);
            sessionProcess = null;
          });

          sessionProcess.stdout.on('data', (data) => {
            const output = data.toString();
            console.log('Session stdout:', output);
            ws.send(output);
          });

          sessionProcess.stderr.on('data', (data) => {
            const error = data.toString();
            console.error('Session stderr:', error);
            ws.send(error);
          });

          sessionProcess.on('close', (code) => {
            console.log('Session closed with code:', code);
            ws.send(`Session closed with code ${code}\r\n$ `);
            sessionProcess = null;
          });

          ws.send('Connected. Run commands!\r\n$ ');
        }
      } catch (err) {
        console.error('ECS error:', err);
        ws.send(`ECS connection failed: ${err.message}\r\n$ `);
      }
    } else if (data.command && sessionProcess) {
      console.log('Executing command:', data.command);
      sessionProcess.stdin.write(data.command + '\n');
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
    if (sessionProcess) {
      sessionProcess.kill();
      sessionProcess = null;
    }
  });
});