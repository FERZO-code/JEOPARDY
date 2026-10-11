'use strict';
/* Funzione Vercel: tutte le chiamate /api/* arrivano qui (vedi vercel.json).
   Le stanze vivono in Upstash Redis (integrazione del Marketplace di Vercel). */
const { handle, createUpstashStore } = require('../lib/party-api');

let store = null;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if(!url || !token){
    res.status(503).json({error:'nodb', message:'Database non collegato'});
    return;
  }
  store = store || createUpstashStore(url, token);
  try{
    const q = req.query || {};
    const out = await handle({
      method: req.method,
      route: String(q.p || ''),
      query: q,
      body: req.body || {},
      ip: String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim(),
      lan: []
    }, store);
    res.status(out.status).json(out.json);
  }catch(e){
    res.status(500).json({error:'errore del server'});
  }
};
