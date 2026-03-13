import http.server
import socketserver
import json
import subprocess
import os
import psutil  # type: ignore
import threading

PORT = 3000

class APIHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/status':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            
            status = {}
            for s in ['filebrowser', 'ttyd', 'sshx']:
                proc = subprocess.run(['pgrep', '-f', s], capture_output=True, text=True)
                # Ensure the match is not the python backend querying itself
                is_running = any(p for p in proc.stdout.strip().split('\n') if p)
                status[s] = 'Running' if is_running else 'Stopped'
            
            self.wfile.write(json.dumps({
                'filebrowser': status['filebrowser'], 
                'wetty': status['ttyd'], 
                'sshx': status['sshx']
            }).encode())
            
        elif self.path == '/stats':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            
            cpu = int(psutil.cpu_percent(interval=None))
            mem = int(psutil.virtual_memory().percent)
            disk = int(psutil.disk_usage('/').percent)
            
            self.wfile.write(json.dumps({'cpu': cpu, 'mem': mem, 'disk': disk}).encode())
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path.startswith('/restart/'):
            service = self.path.split('/')[-1]
            mapped_service = 'ttyd' if service == 'wetty' else service
            
            cmd = ''
            if mapped_service == 'filebrowser':
                cmd = 'filebrowser -r / &'
            elif mapped_service == 'ttyd':
                cmd = 'ttyd -p 10000 bash &'
            elif mapped_service == 'sshx':
                cmd = 'sshx -q &'
            else:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'Unknown service')
                return

            subprocess.Popen(f"pkill -f {mapped_service}; {cmd}", shell=True)
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(f'Restarted {service}'.encode())
        else:
            self.send_error(404)

# Initialize CPU measuring interval
psutil.cpu_percent(interval=None)

# Handle broken pipes quietly
class QuietServer(socketserver.TCPServer):
    def handle_error(self, request, client_address):
        pass

with QuietServer(("", PORT), APIHandler) as httpd:
    print(f"Python Backend API running on port {PORT}")
    httpd.serve_forever()
