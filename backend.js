const express = require('express');
const { exec } = require('child_process');
const os = require('os');
const app = express();
const port = 3000;

function getCPUUsage() {
    const cpus = os.cpus();
    let idle=0, total=0;
    cpus.forEach(core=>{
        for(let type in core.times) total+=core.times[type];
        idle+=core.times.idle;
    });
    return Math.round(100 - (idle/total*100));
}

app.get('/stats', (req,res)=>{
    const memUsage = Math.round((1 - os.freemem()/os.totalmem())*100);
    // Use df -h / to get correct disk usage
    exec("df -h / | awk 'NR==2 {print $5}' | sed 's/%//'", (err, stdout) => {
        let diskUsage = 0;
        if(!err && stdout) {
            diskUsage = parseInt(stdout.trim()) || 0;
        }
        const cpuUsage = getCPUUsage();
        res.json({cpu: cpuUsage, mem: memUsage, disk: diskUsage});
    });
});

app.get('/status', (req,res)=>{
    const services = ['filebrowser','wetty','sshx'];
    let status={};
    let count=0;
    services.forEach(s=>{
        // Use pgrep -f to match process arguments correctly (useful for wetty via node)
        exec(`pgrep -f ${s}`, (err, stdout)=>{
            status[s] = stdout && stdout.trim().length > 0 ? 'Running' : 'Stopped';
            count++;
            if(count === services.length) res.json(status);
        });
    });
});

app.post('/restart/:service', (req,res)=>{
    const service = req.params.service;
    let cmd = '';
    if (service === 'filebrowser') cmd = 'filebrowser -r / &';
    else if (service === 'wetty') cmd = 'wetty --port 10000 &';
    else if (service === 'sshx') cmd = 'sshx -q &';
    else return res.status(400).send('Unknown service');
    
    exec(`pkill -f ${service}; ${cmd}`, (err)=>{
        if(err) return res.status(500).send('Failed to restart');
        res.send('Restarted ' + service);
    });
});

app.listen(port, ()=>console.log(`Backend API running on port ${port}`));
