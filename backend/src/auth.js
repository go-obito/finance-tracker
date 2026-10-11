import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import express from 'express';
import { HttpError, asyncRoute } from './http.js';

const providerSettings = {
  google: { issuer: ['https://accounts.google.com', 'accounts.google.com'], jwks: 'https://www.googleapis.com/oauth2/v3/certs', audience: 'GOOGLE_CLIENT_ID' },
  apple: { issuer: ['https://appleid.apple.com'], jwks: 'https://appleid.apple.com/auth/keys', audience: 'APPLE_CLIENT_ID' },
};
const keySets = new Map();
const digest = (value) => createHash('sha256').update(value).digest('hex');

function providerConfig(provider, config) {
  const settings = providerSettings[provider];
  if (!settings) throw new HttpError(400, 'unsupported_provider', 'Provider must be google or apple.');
  const audience = config[settings.audience];
  if (!audience) throw new HttpError(503, 'provider_not_configured', `${provider} sign-in is not configured.`);
  if (!keySets.has(provider)) keySets.set(provider, createRemoteJWKSet(new URL(settings.jwks)));
  return { settings, audience, keySet: keySets.get(provider) };
}

async function verifyIdentityToken(provider, idToken, challenge, config) {
  if (typeof idToken !== 'string' || idToken.length > 12_000) {
    throw new HttpError(400, 'invalid_identity_token', 'A valid provider identity token is required.');
  }
  const { settings, audience, keySet } = providerConfig(provider, config);
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, keySet, { issuer: settings.issuer, audience, algorithms: ['RS256'] }));
  } catch {
    throw new HttpError(401, 'invalid_identity_token', 'The provider identity token could not be verified.');
  }

  const receivedNonce = payload.nonce;
  const validNonce = typeof receivedNonce === 'string' && (
    safeEqual(receivedNonce, challenge.nonceHash) || safeEqual(digest(receivedNonce), challenge.nonceHash)
  );
  if (!validNonce || typeof payload.sub !== 'string' || !payload.sub || payload.email_verified === false) {
    throw new HttpError(401, 'invalid_identity_token', 'The identity token is missing a valid subject or sign-in challenge.');
  }
  return { subject: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined };
}

function safeEqual(left, right) {
  const first = Buffer.from(left);
  const second = Buffer.from(right);
  return first.length === second.length && timingSafeEqual(first, second);
}

function tokenDigest(value, config) {
  return createHmac('sha256', config.SESSION_SECRET).update(value).digest('hex');
}

export function createAuthRouter({ database, config }) {
  const router = express.Router();

  router.post('/challenge/:provider', asyncRoute(async (request, response) => {
    providerConfig(request.params.provider, config);
    const nonce = randomBytes(32).toString('base64url');
    const challengeId = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    await database.collection('authChallenges').insertOne({ _id: challengeId, provider: request.params.provider, nonceHash: digest(nonce), expiresAt });
    response.status(201).json({ challengeId, nonce, expiresAt });
  }));

  router.post('/session', asyncRoute(async (request, response) => {
    const { provider, idToken, challengeId } = request.body ?? {};
    const challenge = await database.collection('authChallenges').findOne({ _id: challengeId, provider, expiresAt: { $gt: new Date() } });
    if (!challenge) throw new HttpError(401, 'invalid_challenge', 'The sign-in challenge is missing, expired, or already used.');
    const identity = await verifyIdentityToken(provider, idToken, { ...challenge, nonce: request.body.nonce }, config);
    const consumed = await database.collection('authChallenges').deleteOne({ _id: challengeId, nonceHash: challenge.nonceHash });
    if (consumed.deletedCount !== 1) throw new HttpError(401, 'invalid_challenge', 'The sign-in challenge has already been used.');

    const identities = database.collection('identities');
    let link = await identities.findOne({ provider, subject: identity.subject });
    let userId = link?.userId;
    let createdUser = false;
    if (!userId) {
      userId = randomUUID();
      createdUser = true;
      const now = new Date();
      await database.collection('users').insertOne({ _id: userId, email: identity.email, status: 'active', timezone: 'Africa/Accra', createdAt: now, updatedAt: now });
      try {
        await identities.insertOne({ provider, subject: identity.subject, userId, createdAt: now });
      } catch (error) {
        await database.collection('users').deleteOne({ _id: userId });
        if (error?.code !== 11000) throw error;
        link = await identities.findOne({ provider, subject: identity.subject });
        userId = link.userId;
        createdUser = false;
      }
    }

    if (createdUser) await seedDefaultCategories(database, userId);

    const sessionToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + config.SESSION_TTL_DAYS * 86_400_000);
    await database.collection('sessions').insertOne({ tokenHash: tokenDigest(sessionToken, config), userId, createdAt: new Date(), expiresAt });
    response.status(201).json({ token: sessionToken, tokenType: 'Bearer', expiresAt, userId });
  }));

  router.get('/me', requireAuth(database), asyncRoute(async (request, response) => {
    const user = await database.collection('users').findOne({ _id: request.userId }, { projection: { email: 1, timezone: 1, createdAt: 1 } });
    if (!user) throw new HttpError(401, 'session_expired', 'The user session is no longer valid.');
    response.json({ id: user._id, email: user.email, timezone: user.timezone, createdAt: user.createdAt });
  }));

  router.get('/me/export', requireAuth(database), asyncRoute(async (request, response) => {
    const collections = ['accounts', 'transactions', 'transfers', 'categories', 'imports', 'savingsGoals', 'contributions'];
    const records = await Promise.all(collections.map(async (name) => [
      name,
      await database.collection(name).find({ userId: request.userId }).toArray(),
    ]));
    const user = await database.collection('users').findOne({ _id: request.userId }, { projection: { _id: 0, passwordHash: 0 } });
    response.setHeader('Content-Disposition', 'attachment; filename="finance-tracker-export.json"');
    response.json({ exportedAt: new Date(), user, data: Object.fromEntries(records) });
  }));

  router.delete('/me', requireAuth(database), asyncRoute(async (request, response) => {
    if (request.header('X-Confirm-Deletion') !== 'DELETE') throw new HttpError(428, 'deletion_confirmation_required', 'Send X-Confirm-Deletion: DELETE to confirm permanent account deletion.');
    const collections = ['accounts', 'transactions', 'transfers', 'categories', 'imports', 'savingsGoals', 'contributions', 'syncOperations', 'sessions'];
    await Promise.all(collections.map((name) => database.collection(name).deleteMany({ userId: request.userId })));
    await database.collection('identities').deleteMany({ userId: request.userId });
    await database.collection('users').deleteOne({ _id: request.userId });
    response.status(204).end();
  }));

  router.delete('/session', requireAuth(database), asyncRoute(async (request, response) => {
    await database.collection('sessions').deleteOne({ tokenHash: request.sessionHash });
    response.status(204).end();
  }));

  router.post('/links/:provider', requireAuth(database), asyncRoute(async (request, response) => {
    const { idToken, challengeId, nonce } = request.body ?? {};
    const provider = request.params.provider;
    const challenge = await database.collection('authChallenges').findOne({ _id: challengeId, provider, expiresAt: { $gt: new Date() } });
    if (!challenge) throw new HttpError(401, 'invalid_challenge', 'The sign-in challenge is missing, expired, or already used.');
    const identity = await verifyIdentityToken(provider, idToken, { ...challenge, nonce }, config);
    const consumed = await database.collection('authChallenges').deleteOne({ _id: challengeId, nonceHash: challenge.nonceHash });
    if (consumed.deletedCount !== 1) throw new HttpError(401, 'invalid_challenge', 'The sign-in challenge has already been used.');
    const identities = database.collection('identities');
    const existing = await identities.findOne({ provider, subject: identity.subject });
    if (existing && existing.userId !== request.userId) throw new HttpError(409, 'identity_already_linked', 'This provider identity belongs to another user.');
    if (!existing) await identities.insertOne({ provider, subject: identity.subject, userId: request.userId, createdAt: new Date() });
    response.status(201).json({ provider, linked: true });
  }));

  return router;
}

async function seedDefaultCategories(database, userId) {
  const names = [
    ['Food', 'expense'], ['Transport', 'expense'], ['Bills', 'expense'], ['Shopping', 'expense'],
    ['Salary', 'income'], ['Gifts', 'both'], ['Savings', 'both'], ['Bank fees', 'expense'],
    ['Mobile-money fees', 'expense'], ['Interest', 'income'],
  ];
  const createdAt = new Date();
  await database.collection('categories').insertMany(names.map(([name, kind]) => ({
    _id: randomUUID(), userId, name, kind, parentId: null, revision: 1,
    operationKeys: [], createdAt, updatedAt: createdAt, archivedAt: null, isDefault: true,
  })));
}

export function requireAuth(database) {
  return asyncRoute(async (request, response, next) => {
    const token = request.header('Authorization')?.match(/^Bearer ([A-Za-z0-9_-]{40,})$/)?.[1];
    if (!token) throw new HttpError(401, 'authentication_required', 'A valid bearer session is required.');
    const tokenHash = tokenDigest(token, request.app.locals.config);
    const session = await database.collection('sessions').findOne({ tokenHash, expiresAt: { $gt: new Date() } });
    if (!session) throw new HttpError(401, 'session_expired', 'The session is invalid or expired.');
    const user = await database.collection('users').findOne({ _id: session.userId, status: 'active' }, { projection: { _id: 1 } });
    if (!user) throw new HttpError(401, 'session_expired', 'The user account is unavailable.');
    request.userId = session.userId;
    request.sessionHash = tokenHash;
    next();
  });
}
