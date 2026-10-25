// Models and sign-ins, from the browser: subscriptions, API keys, local servers, and sharing Pi's sign-ins.
import express from 'express';
import * as host from '../runtime.mjs';
import * as conn from '../connections.mjs';
import {config} from '../config.mjs';
import {fail, handle, modelsChanged, ready} from './common.mjs';

const router = express.Router();

router.get(
  '/models',
  handle(async (q, r) => r.json({models: await host.listModels()})),
);
router.get(
  '/setup',
  handle(async (q, r) => r.json({...(await conn.status()), defaultModel: config.defaultModel, ready: ready()})),
);
router.post(
  '/connections/mode',
  handle(async (q, r) => {
    await host.setConnectionMode(q.body?.mode);
    await modelsChanged();
    r.json(await conn.status());
  }),
);
router.post('/connections/login', (q, r) => {
  try {
    r.json(conn.startLogin(q.body?.provider, q.body?.type, modelsChanged));
  } catch (e) {
    fail(r, 400, e);
  }
});
router.get('/connections/login/:id', (q, r) => {
  try {
    r.json(conn.getLogin(q.params.id));
  } catch (e) {
    fail(r, 404, e);
  }
});
router.post('/connections/login/:id/answer', (q, r) => {
  try {
    r.json(conn.answerLogin(q.params.id, q.body?.promptId, q.body?.value));
  } catch (e) {
    fail(r, 400, e);
  }
});
router.post('/connections/login/:id/cancel', (q, r) => {
  try {
    r.json(conn.cancelLogin(q.params.id));
  } catch (e) {
    fail(r, 404, e);
  }
});
router.post(
  '/connections/logout',
  handle(async (q, r) => {
    await conn.logout(q.body?.provider);
    await modelsChanged();
    r.json(await conn.status());
  }),
);
// LM Studio and Ollama by id, or any OpenAI-compatible server: {custom: {id, name, baseUrl, apiKey}}.
router.post(
  '/connections/local',
  handle(async (q, r) => {
    await host.connectLocal(q.body?.id, q.body?.custom);
    await modelsChanged();
    r.json(await conn.status());
  }),
);
router.delete(
  '/connections/local/:id',
  handle(async (q, r) => {
    await host.forgetLocal(q.params.id);
    await modelsChanged();
    r.json(await conn.status());
  }),
);

export default router;
