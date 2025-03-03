import { WebSocketServer } from 'ws';
import { ECSClient, ExecuteCommandCommand } from '@aws-sdk/client-ecs';
import { spawn } from 'child_process';

const wss = new WebSocketServer({ port: 8080 });
const ecsClient = new ECSClient({ region: 'ap-south-1' }); // Match your region

wss.on('connection', (ws) => {
  console.log('Client connected');
  let sessionProcess = null;
  let taskArn = null;
  let clusterArn = null;

  ws.on('message', async (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
      console.log('Received message:', data);
    } catch (error) {
      console.error('Failed to parse message:', error);
      ws.send(JSON.stringify({ output: 'Error: Invalid message format\r\n$ ' }));
      return;
    }

    if (data.taskArn && !sessionProcess) {
      try {
        taskArn = data.taskArn;
        clusterArn = data.clusterArn || 'default';
        console.log('Starting ECS Exec session with:', { taskArn, clusterArn });

        const command = {
          cluster: clusterArn,
          task: taskArn,
          interactive: true,
          command: '/bin/bash', // Use bash for Ubuntu
        };

        const ecsCommand = new ExecuteCommandCommand(command);
        const response = await ecsClient.send(ecsCommand);
        console.log('ECS response:', response);

        if (response.session) {
          // Start SSM session using the session-manager-plugin via CLI
          const sessionArgs = [
            JSON.stringify(response.session),
            'ap-south-1', // Match your region
            'StartSession',
          ];

          sessionProcess = spawn('session-manager-plugin', sessionArgs, {
            stdio: ['pipe', 'pipe', 'pipe'], // Enable stdin/stdout/stderr
          });

          sessionProcess.stdout.on('data', (data) => {
            console.log('Session stdout:', data.toString());
            ws.send(JSON.stringify({ output: data.toString() }));
          });

          sessionProcess.stderr.on('data', (data) => {
            console.error('Session stderr:', data.toString());
            ws.send(JSON.stringify({ output: data.toString() }));
          });

          sessionProcess.on('close', (code) => {
            console.log('Session closed with code:', code);
            ws.send(JSON.stringify({ output: 'Session closed\r\n$ ' }));
            sessionProcess = null;
          });

          ws.send(JSON.stringify({ output: 'ECS task connected. Run commands!\r\n$ ' }));
        }
      } catch (err) {
        console.error('ECS error:', err);
        ws.send(JSON.stringify({ output: 'ECS connection failed: ' + err.message + '\r\n$ ' }));
      }
    } else if (data.command && sessionProcess) {
      console.log('Executing command:', data.command);
      sessionProcess.stdin.write(data.command + '\n'); // Send command to the session
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

console.log('WebSocket server running on port 8080');
xj