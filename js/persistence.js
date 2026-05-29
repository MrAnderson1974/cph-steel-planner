'use strict';

const persistence = {
    async loadQueue(token, repo) {
        const url = `https://api.github.com/repos/${repo}/contents/data/queue.json`;
        const res = await fetch(url, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        if (!res.ok) throw new Error(`GitHub ${res.status}`);
        const data = await res.json();
        // atob() er Latin-1 — brug TextDecoder for korrekt UTF-8 (æøå)
        const bytes = Uint8Array.from(atob(data.content.replace(/\n/g, '')), c => c.charCodeAt(0));
        const content = JSON.parse(new TextDecoder('utf-8').decode(bytes));
        return { content, sha: data.sha };
    },

    async saveQueue(token, repo, queue, sha) {
        const url = `https://api.github.com/repos/${repo}/contents/data/queue.json`;
        const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(queue, null, 2))));
        const res = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify({
                message: `Update queue - ${new Date().toISOString()}`,
                content: encoded,
                sha: sha
            })
        });
        if (res.status === 409) throw new Error('CONFLICT');
        if (!res.ok) throw new Error(`Save ${res.status}`);
        const result = await res.json();
        return result.content.sha;
    }
};
