const nodemailer = require('nodemailer');

// Rate limiting (por IP, máx 10/min)
const rateLimit = new Map();
function isRateLimited(ip) {
    const now = Date.now();
    const entry = rateLimit.get(ip);
    if (!entry || now - entry.start > 60000) {
        rateLimit.set(ip, { count: 1, start: now });
        return false;
    }
    return ++entry.count > 10;
}

// Identificar fonte de tráfego
function identifyTrafficSource(data) {
    if (data.gclid) return '🟡 Google Ads';
    if (data.fbclid) return '🔵 Facebook Ads';
    if (data.utm_source) {
        const src = data.utm_source.toLowerCase();
        if (src.includes('google')) return data.utm_medium === 'cpc' ? '🟡 Google Ads' : '🟢 Google Orgânico';
        if (src.includes('facebook') || src.includes('fb')) return '🔵 Facebook';
        if (src.includes('instagram') || src.includes('ig')) return '🟣 Instagram';
        if (src.includes('tiktok')) return '⚫ TikTok';
        return '🔗 ' + data.utm_source;
    }
    const ref = (data.referrer || '').toLowerCase();
    if (!ref || ref === 'acesso direto') return '⬜ Acesso Direto';
    if (ref.includes('google')) return '🟢 Google Orgânico';
    if (ref.includes('facebook')) return '🔵 Facebook';
    if (ref.includes('instagram')) return '🟣 Instagram';
    return '🔗 Referral';
}

// Geolocalização — prioriza headers Vercel, fallback para ip-api
async function getGeoData(ip, headers) {
    const vercelCountry = headers['x-vercel-ip-country'] || '';
    const vercelRegion = headers['x-vercel-ip-country-region'] || '';
    const vercelCity = headers['x-vercel-ip-city'] || '';
    const vercelLat = headers['x-vercel-ip-latitude'] || '';
    const vercelLon = headers['x-vercel-ip-longitude'] || '';

    const brStates = {
        'AC':'Acre','AL':'Alagoas','AP':'Amapá','AM':'Amazonas','BA':'Bahia',
        'CE':'Ceará','DF':'Distrito Federal','ES':'Espírito Santo','GO':'Goiás',
        'MA':'Maranhão','MT':'Mato Grosso','MS':'Mato Grosso do Sul','MG':'Minas Gerais',
        'PA':'Pará','PB':'Paraíba','PR':'Paraná','PE':'Pernambuco','PI':'Piauí',
        'RJ':'Rio de Janeiro','RN':'Rio Grande do Norte','RS':'Rio Grande do Sul',
        'RO':'Rondônia','RR':'Roraima','SC':'Santa Catarina','SP':'São Paulo',
        'SE':'Sergipe','TO':'Tocantins'
    };

    const countries = {
        'BR':'Brasil','US':'Estados Unidos','AR':'Argentina','PT':'Portugal',
        'PY':'Paraguai','UY':'Uruguai','CL':'Chile','CO':'Colômbia','MX':'México'
    };

    let geo = {
        city: decodeURIComponent(vercelCity) || '-',
        region: brStates[vercelRegion] || vercelRegion || '-',
        country: countries[vercelCountry] || vercelCountry || '-',
        country_code: vercelCountry || '-',
        lat: vercelLat || '-',
        lon: vercelLon || '-',
        isp: '-', org: '-', as_number: '-',
        is_mobile: false, is_proxy: false, is_hosting: false
    };

    try {
        if (ip && ip !== '127.0.0.1' && ip !== '::1' && !ip.startsWith('192.168.') && !ip.startsWith('10.')) {
            const res = await fetch(`http://ip-api.com/json/${ip}?fields=city,regionName,country,isp,org,as,mobile,proxy,hosting,status&lang=pt-BR`);
            const api = await res.json();
            if (api.status === 'success') {
                if (geo.city === '-') geo.city = api.city || '-';
                if (geo.region === '-') geo.region = api.regionName || '-';
                if (geo.country === '-') geo.country = api.country || '-';
                geo.isp = api.isp || '-';
                geo.org = api.org || '-';
                geo.as_number = api.as || '-';
                geo.is_mobile = api.mobile || false;
                geo.is_proxy = api.proxy || false;
                geo.is_hosting = api.hosting || false;
            }
        }
    } catch (e) {}

    return geo;
}

function formatDateBR() {
    return new Date().toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
}

function row(label, value, color) {
    const c = color || '#666';
    const v = value || '-';
    return `<tr><td style="padding:4px 0;width:140px;color:${c};font-size:13px;">${label}</td><td style="padding:4px 0;font-size:13px;"><strong>${v}</strong></td></tr>`;
}

function sectionHeader(emoji, title) {
    return `<h3 style="color:#1e3a8a;font-size:13px;text-transform:uppercase;border-bottom:2px solid #e2e8f0;padding-bottom:6px;margin:22px 0 10px;">${emoji} ${title}</h3><table style="width:100%;color:#333;border-collapse:collapse;">`;
}

function buildEmailHTML(data, geo, ip, userAgent) {
    const trafficSource = identifyTrafficSource(data);
    const dataBR = formatDateBR();

    const alerts = [];
    if (geo.is_proxy) alerts.push('⚠️ VPN/Proxy detectado');
    if (geo.is_hosting) alerts.push('⚠️ IP de datacenter/hosting');
    if (data.save_data) alerts.push('📴 Modo economia de dados ativo');
    if (data.battery_level && data.battery_level !== '-') {
        const lvl = parseInt(data.battery_level);
        if (lvl <= 20) alerts.push('🪫 Bateria baixa (' + data.battery_level + ')');
    }

    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;padding:16px;">
<div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.1);">

    <div style="background:#25d366;color:white;padding:20px 24px;">
        <h1 style="margin:0;font-size:20px;">🟢 Novo Lead WhatsApp</h1>
        <p style="margin:8px 0 0;opacity:0.9;font-size:14px;">${data.landing_page || 'Landing Page'}</p>
    </div>

    <div style="padding:24px;">

        <div style="background:#f0fdf4;border-left:4px solid #25d366;padding:14px 16px;border-radius:0 8px 8px 0;margin-bottom:16px;">
            <div style="font-size:14px;color:#333;">
                📅 <strong>${dataBR}</strong> (Brasília)<br>
                📄 <strong>Página:</strong> ${data.page_url || '-'}<br>
                🔘 <strong>Botão:</strong> ${data.button_label || '-'}
            </div>
        </div>

        ${alerts.length > 0 ? `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:#991b1b;">${alerts.join('<br>')}</div>` : ''}

        ${sectionHeader('📱', 'Dispositivo')}
            ${row('Tipo', data.device_type)}
            ${row('Sistema', data.os)}
            ${row('Navegador', data.browser)}
            ${row('Tela', data.screen_res || data.screen)}
            ${row('Viewport', data.viewport)}
            ${row('Orientação', data.orientation)}
            ${row('Densidade Tela', data.pixel_ratio ? data.pixel_ratio + 'x' : '-')}
            ${row('Cores da Tela', data.color_depth)}
            ${row('Tela Touch', data.is_touch ? 'Sim' : 'Não')}
            ${row('Núcleos CPU', data.cpu_cores)}
            ${row('Memória RAM', data.ram_gb !== '-' ? data.ram_gb + ' GB' : '-')}
            ${row('Idioma Principal', data.language)}
            ${row('Todos os Idiomas', data.languages)}
            ${row('Fuso Horário', data.timezone)}
        </table>

        ${sectionHeader('📶', 'Conexão e Bateria')}
            ${row('Conexão', data.connection_type)}
            ${row('Velocidade Download', data.downlink_speed)}
            ${row('Economia Dados', data.save_data ? '⚠️ Sim' : 'Não')}
            ${row('Conectado', data.online === false ? '❌ Offline' : '✅ Sim')}
            ${row('Bateria', data.battery_level)}
            ${row('Carregando', data.battery_charging)}
            ${row('Rede Móvel', geo.is_mobile ? 'Sim (dados móveis)' : 'Não (Wi-Fi/cabo)')}
        </table>

        ${sectionHeader('📍', 'Localização')}
            ${row('Cidade', geo.city)}
            ${row('Estado', geo.region)}
            ${row('País', geo.country)}
            ${row('ISP', geo.isp)}
            ${row('Organização', geo.org)}
            ${row('ASN', geo.as_number)}
            ${row('Coordenadas', (geo.lat !== '-' && geo.lon !== '-') ? geo.lat + ', ' + geo.lon : '-')}
            ${row('IP', ip)}
            ${row('VPN/Proxy', geo.is_proxy ? '⚠️ Sim' : 'Não')}
            ${row('IP Datacenter', geo.is_hosting ? '⚠️ Sim' : 'Não')}
        </table>
        ${(geo.lat !== '-' && geo.lon !== '-') ? `<div style="margin:8px 0 0;text-align:center;"><a href="https://www.google.com/maps?q=${geo.lat},${geo.lon}" target="_blank" style="font-size:12px;color:#1e3a8a;text-decoration:none;font-weight:600;">📌 Ver no Google Maps →</a></div>` : ''}

        ${sectionHeader('🔎', 'Origem do Tráfego')}
            ${row('Fonte', trafficSource, '#1e3a8a')}
            ${row('Origem', data.referrer || 'Acesso direto')}
            ${data.gclid ? row('GCLID', data.gclid) : ''}
            ${data.fbclid ? row('FBCLID', data.fbclid) : ''}
        </table>

        ${(data.utm_source || data.utm_medium || data.utm_campaign || data.utm_term || data.utm_content) ? `
        ${sectionHeader('🎯', 'Parâmetros UTM')}</table>
        <div style="background:#f8fafc;padding:12px 16px;border-radius:8px;font-size:12px;font-family:monospace;color:#334155;line-height:1.8;">
            ${data.utm_source ? `utm_source: <strong>${data.utm_source}</strong><br>` : ''}
            ${data.utm_medium ? `utm_medium: <strong>${data.utm_medium}</strong><br>` : ''}
            ${data.utm_campaign ? `utm_campaign: <strong>${data.utm_campaign}</strong><br>` : ''}
            ${data.utm_term ? `utm_term: <strong>${data.utm_term}</strong><br>` : ''}
            ${data.utm_content ? `utm_content: <strong>${data.utm_content}</strong>` : ''}
        </div>` : ''}

        ${sectionHeader('📊', 'Comportamento')}
            ${row('Tempo na Página', (data.time_on_page || 0) + ' segundos')}
            ${row('Rolagem', (data.scroll_pct || 0) + '%')}
            ${row('Cliques Antes', (data.clicks_before || 0) + ' interações')}
            ${row('Tipo Visita', data.first_visit ? '🆕 Primeira visita' : '🔄 Retorno')}
        </table>

        <div style="margin-top:16px;padding:10px 14px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">
            <div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">IDENTIFICAÇÃO DO NAVEGADOR</div>
            <div style="font-size:11px;color:#64748b;word-break:break-all;font-family:monospace;">${userAgent || '-'}</div>
        </div>

    </div>

    <div style="background:#f8fafc;padding:14px 24px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;text-align:center;">
        Notificação automática — ${data.landing_page || 'Landing Page'} — v2
    </div>

</div>
</body>
</html>`;
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const ip = (req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket?.remoteAddress || '').split(',')[0].trim();
    const userAgent = req.headers['user-agent'] || '-';

    if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests' });

    try {
        let data = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

        const geo = await getGeoData(ip, req.headers);
        const html = buildEmailHTML(data, geo, ip, userAgent);

        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
        });

        await transporter.sendMail({
            from: `"WhatsApp Tracker" <${process.env.GMAIL_USER}>`,
            to: 'msvasculares@gmail.com',
            cc: 'mauriciohy@gmail.com',
            subject: `🟢 Novo Lead WhatsApp - ${data.landing_page || 'Landing Page'}`,
            html: html
        });

        return res.status(200).json({ ok: true });
    } catch (err) {
        console.error('WhatsApp notify error:', err);
        return res.status(500).json({ error: 'Internal error' });
    }
};
