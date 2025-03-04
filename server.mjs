#!/usr/bin/env node
import { WebSocketServer } from 'ws';
import { ECSClient, ExecuteCommandCommand } from '@aws-sdk/client-ecs';
import { spawn } from 'child_process';

const wss = new WebSocketServer({ port: 8080 });
const ecsClient = new ECSClient({ region: 'ap-south-1' });

console.log('WebSocket server running on port 8080');

wss.on('connection', (ws) => {
  console.log('Client connected');
  let sessionProcess = null;
  let taskArn = null;
  let clusterArn = null;

  // Function to wait with countdown
  const waitWithCountdown = (seconds) => {
    return new Promise((resolve) => {
      let remaining = seconds;
      const interval = setInterval(() => {
        if (remaining > 0) {
          ws.send(`Waiting ${remaining}...\r\n`);
          console.log(`Countdown: Waiting ${remaining}...`);
          remaining--;
        } else {
          clearInterval(interval);
          ws.send('Executing ECS command now...\r\n');
          console.log('Countdown complete, executing command');
          resolve();
        }
      }, 1000); // Update every second
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

        // Send initial message and start 60-second countdown
        ws.send('Task received, waiting 60 seconds for it to stabilize...\r\n');
        await waitWithCountdown(60); // Wait 60 seconds with countdown

        const command = new ExecuteCommandCommand({
          cluster: clusterArn,
          task: taskArn,
          interactive: true,
          command: '/bin/sh -c "stty -echo; /bin/sh"', // Start shell with echo disabled
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

          ws.send('ECS task connected. Run commands!\r\n$ ');
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
