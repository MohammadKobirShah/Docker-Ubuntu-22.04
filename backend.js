const express = require('express');
const { exec } = require('child_process');
const os = require('os');
const app = express();
const port = 3000;

function getCPUUsage() {
    const cpus = os.cpus();
    let idle=0, total=0;
    cpus.forEach(core=>{
        for(type in core.times) total+=core.times[type];
        idle+=core.times.idle;
    });
    return Math.round(100 - (idle/total*100));
}

app.get('/stats', (req,res)=>{
    const memUsage = Math.round((1 - os.freemem()/os.totalmem())*100);
    const diskUsage = Math.round(50 + Math.random()*30); // demo, replace with df
    const cpuUsage = getCPUUsage();
    res.json({cpu: cpuUsage, mem: memUsage, disk: diskUsage});
});

app.get('/status', (req,res)=>{
    const services = ['filebrowser','wetty','sshx'];
    let status={};
    let count=0;
    services.forEach(s=>{
        exec(`pgrep -x ${s}`, (err, stdout)=>{
            status[s] = stdout ? 'Running' : 'Stopped';
            count++;
            if(count === services.length) res.json(status);
        });
    });
});

app.post('/restart/:service', (req,res)=>{
    const service = req.params.service;
    exec(`pkill -f ${service} && ${service} &`, (err)=>{
        if(err) return res.status(500).send('Failed');
        res.send('Restarted '+service);
    });
});

app.listen(port, ()=>console.log(`Backend API running on port ${port}`));
