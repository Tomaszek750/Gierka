const http = require('http');

// --- TUTAJ JEST CAŁY KOD STRONY (HTML/CSS/JS) ---
const HTML_CONTENT = `
<!DOCTYPE html>
<html lang="pl">
<head>
    <meta charset="UTF-8">
    <title>Gra Samochodowa</title>
    <style>
        body { font-family: sans-serif; max-width: 600px; margin: 20px auto; padding: 20px; background: #333; color: white; }
        .card { background: #444; padding: 20px; border-radius: 10px; margin-bottom: 20px; border: 1px solid #555; }
        input { padding: 10px; width: 70%; border: none; border-radius: 5px; }
        button { padding: 10px 20px; background: #e91e63; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; }
        button:hover { background: #c2185b; }
        .hidden { display: none; }
        a { color: #4fc3f7; }
        h1 { color: #e91e63; }
        .role { font-weight: bold; color: #ffeb3b; }
    </style>
</head>
<body>
    <h1>🚗 Licytator Aut</h1>
    
    <div id="login" class="card">
        <h3>Podaj nick:</h3>
        <input type="text" id="nick">
        <button onclick="join()">Graj</button>
    </div>

    <div id="game" class="card hidden">
        <p>Twoja rola: <span id="roleDisplay" class="role">...</span></p>
        <div id="msg" style="margin-bottom:15px; color:#aaa;">Czekanie na graczy...</div>

        <div id="view-judge-req" class="hidden">
            <input type="text" id="reqInput" placeholder="Np. Sportowe do 100k...">
            <button onclick="sendReq()">Wyślij wymagania</button>
        </div>

        <div id="view-dealer-submit" class="hidden">
            <p>Wymagania: <b id="reqText"></b></p>
            <input type="text" id="linkInput" placeholder="Link do aukcji...">
            <button onclick="sendLink()">Wyślij Link</button>
        </div>

        <div id="view-vote" class="hidden">
            <h3>Wybierz zwycięzcę:</h3>
            <div id="voteList"></div>
        </div>
    </div>

    <script>
        let myId = null;
        
        async function join() {
            const nick = document.getElementById('nick').value;
            if(!nick) return;
            const res = await fetch('/join', { method: 'POST', body: nick });
            const data = await res.json();
            myId = data.id;
            document.getElementById('login').classList.add('hidden');
            document.getElementById('game').classList.remove('hidden');
            setInterval(refresh, 1000); // Odpytuj serwer co sekundę
            refresh();
        }

        async function sendReq() {
            const txt = document.getElementById('reqInput').value;
            await fetch('/req', { method: 'POST', body: JSON.stringify({id: myId, text: txt}) });
        }

        async function sendLink() {
            const link = document.getElementById('linkInput').value;
            await fetch('/submit', { method: 'POST', body: JSON.stringify({id: myId, link: link}) });
            document.getElementById('view-dealer-submit').innerHTML = "<p>Wysłano! Czekaj na innych.</p>";
        }

        async function pick(winnerId) {
            await fetch('/win', { method: 'POST', body: JSON.stringify({id: myId, winnerId: winnerId}) });
        }

        async function refresh() {
            try {
                const res = await fetch('/state');
                const state = await res.json();
                render(state);
            } catch(e) {}
        }

        function render(state) {
            const me = state.players.find(p => p.id === myId);
            if(!me) return; 

            const amIJudge = (state.judgeId === myId);
            document.getElementById('roleDisplay').innerText = amIJudge ? "KLIENT (Sędzia)" : "DEALER";

            // Ukryj wszystko na start
            document.getElementById('view-judge-req').classList.add('hidden');
            document.getElementById('view-dealer-submit').classList.add('hidden');
            document.getElementById('view-vote').classList.add('hidden');

            if (state.phase === 'LOBBY') {
                document.getElementById('msg').innerText = "Czekamy na drugiego gracza...";
                if (state.players.length > 1) document.getElementById('msg').innerText = "Gra zaraz ruszy...";
            } 
            else if (state.phase === 'REQ') {
                document.getElementById('msg').innerText = "Faza Wymagań";
                if(amIJudge) document.getElementById('view-judge-req').classList.remove('hidden');
                else document.getElementById('msg').innerText = "Klient zastanawia się czego chce...";
            }
            else if (state.phase === 'SUBMIT') {
                document.getElementById('msg').innerText = "Szukanie aut!";
                if(!amIJudge) {
                    document.getElementById('view-dealer-submit').classList.remove('hidden');
                    document.getElementById('reqText').innerText = state.req;
                } else {
                    document.getElementById('msg').innerText = "Dealerzy szukają aut dla Ciebie: " + state.req;
                }
            }
            else if (state.phase === 'VOTE') {
                document.getElementById('msg').innerText = "Wybieranie zwycięzcy!";
                document.getElementById('view-vote').classList.remove('hidden');
                
                let html = "";
                state.subs.forEach(s => {
                    html += '<div style="margin:5px; padding:5px; border:1px solid #777;">';
                    html += '<b>' + s.nick + '</b>: <a href="' + s.link + '" target="_blank" style="color:cyan">Link</a>';
                    if(amIJudge) html += ' <button onclick="pick(\\''+s.pid+'\\')" style="padding:2px 10px; font-size:12px;">Wybierz</button>';
                    html += '</div>';
                });
                document.getElementById('voteList').innerHTML = html;
            }
        }
    </script>
</body>
</html>
`;

// --- LOGIKA GRY (BACKEND) ---
let players = [];
let subs = [];
let judgeIdx = 0;
let phase = 'LOBBY'; // LOBBY, REQ, SUBMIT, VOTE
let currentReq = "";

const server = http.createServer((req, res) => {
    // Funkcje pomocnicze
    const send = (obj) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
    };
    
    // Obsługa wczytania strony
    if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(HTML_CONTENT);
        return;
    }

    // Obsługa danych z requestu
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
        try {
            // API: Stan gry
            if (req.url === '/state') {
                // Automatyczny start jeśli jest 2 graczy i jesteśmy w lobby
                if (phase === 'LOBBY' && players.length >= 2) phase = 'REQ';
                
                const judgeId = players[judgeIdx]?.id;
                send({ players, phase, judgeId, req: currentReq, subs });
                return;
            }

            // API: Dołączanie
            if (req.url === '/join') {
                const id = Math.random().toString(36).substr(2);
                players.push({ id, nick: body, score: 0 });
                console.log('Dołączył:', body);
                send({ id });
                return;
            }

            const data = body ? JSON.parse(body) : {};

            // API: Wysłanie wymagań
            if (req.url === '/req' && phase === 'REQ') {
                currentReq = data.text;
                phase = 'SUBMIT';
                subs = [];
                console.log('Wymagania:', currentReq);
                send({ ok: true });
                return;
            }

            // API: Wysłanie linku
            if (req.url === '/submit' && phase === 'SUBMIT') {
                const player = players.find(p => p.id === data.id);
                if (player && !subs.find(s => s.pid === data.id)) {
                    subs.push({ pid: data.id, nick: player.nick, link: data.link });
                    console.log('Otrzymano link od:', player.nick);
                }
                // Jeśli wszyscy (oprócz sędziego) wysłali
                if (subs.length >= players.length - 1) phase = 'VOTE';
                send({ ok: true });
                return;
            }

            // API: Wybór zwycięzcy
            if (req.url === '/win' && phase === 'VOTE') {
                const winner = players.find(p => p.id === data.winnerId);
                if (winner) winner.score++;
                console.log('Wygrał:', winner?.nick);
                
                // Reset rundy
                judgeIdx = (judgeIdx + 1) % players.length;
                phase = 'REQ';
                subs = [];
                currentReq = "";
                send({ ok: true });
                return;
            }

        } catch (err) {
            console.error(err); // Wypisz błąd w konsoli zamiast crashować
            res.writeHead(500);
            res.end("Error");
        }
    });
});

server.listen(3000, () => {
    console.log('--- SERWER DZIAŁA ---');
    console.log('Wejdź na: http://localhost:3000');
});