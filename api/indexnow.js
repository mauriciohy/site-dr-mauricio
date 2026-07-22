// api/indexnow.js
// Notifica Bing/Yandex (via IndexNow) sobre as URLs do sitemap.
// Acesso: GET /api/indexnow?key=<chave do /<chave>.txt>

const HOST = 'www.mauricioyamada.med.br';
const KEY = '91c5a442fa03a8c4944c920734a00c3c';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;

module.exports = async function handler(req, res) {
    if (req.query.key !== KEY) {
        return res.status(401).json({ error: 'unauthorized' });
    }

    const sitemapRes = await fetch(`https://${HOST}/sitemap.xml`);
    if (!sitemapRes.ok) {
        return res.status(502).json({ error: 'sitemap inacessivel', status: sitemapRes.status });
    }

    const xml = await sitemapRes.text();
    const urlList = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);

    if (urlList.length === 0) {
        return res.status(500).json({ error: 'nenhuma URL encontrada no sitemap' });
    }

    const submit = await fetch('https://api.indexnow.org/indexnow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
    });

    return res.status(200).json({
        submitted: urlList.length,
        status: submit.status,
        statusText: submit.statusText,
    });
};
