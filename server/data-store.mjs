import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { Pool } from 'pg';

const DEFAULT_DB = {
  users: {},
  subscriptions: {},
  apiKeys: {},
  sessions: {},
  oauthStates: {},
  usageEvents: []
};

const SCHEMA_SQL = `
alter table if exists users
  add column if not exists is_whitelisted boolean not null default false;
alter table if exists users
  alter column is_whitelisted set default false;

create table if not exists users (
  id text primary key,
  email text,
  name text,
  avatar_url text,
  provider text,
  provider_user_id text,
  stripe_customer_id text,
  is_whitelisted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists users_provider_identity_idx
  on users (provider, provider_user_id)
  where provider is not null and provider_user_id is not null;

create table if not exists subscriptions (
  user_id text primary key references users(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text,
  plan text,
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists api_keys (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  status text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists api_keys_user_id_idx on api_keys (user_id);

create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists sessions_user_id_idx on sessions (user_id);

create table if not exists oauth_states (
  state text primary key,
  created_at timestamptz not null default now()
);

create table if not exists usage_events (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  api_key_id text references api_keys(id) on delete set null,
  action text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists usage_events_user_action_idx
  on usage_events (user_id, action, created_at desc);
`;

function cloneDefaultDb() {
  return {
    users: {},
    subscriptions: {},
    apiKeys: {},
    sessions: {},
    oauthStates: {},
    usageEvents: []
  };
}

function mapUserRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    provider: row.provider,
    providerUserId: row.provider_user_id,
    stripeCustomerId: row.stripe_customer_id,
    isWhitelisted: Boolean(row.is_whitelisted),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  };
}

function mapSubscriptionRow(row) {
  if (!row) {
    return null;
  }

  return {
    userId: row.user_id,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    status: row.status,
    plan: row.plan,
    currentPeriodEnd: row.current_period_end instanceof Date ? row.current_period_end.toISOString() : row.current_period_end,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at
  };
}

function mapApiKeyRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    keyHash: row.key_hash,
    status: row.status,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    lastUsedAt: row.last_used_at instanceof Date ? row.last_used_at.toISOString() : row.last_used_at,
    revokedAt: row.revoked_at instanceof Date ? row.revoked_at.toISOString() : row.revoked_at
  };
}

function mapSessionRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    expiresAt: row.expires_at instanceof Date ? row.expires_at.getTime() : new Date(row.expires_at).getTime()
  };
}

function mapUsageEventRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    apiKeyId: row.api_key_id,
    action: row.action,
    meta: row.meta || {},
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at
  };
}

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.writeChain = Promise.resolve();
  }

  async init() {}

  async close() {}

  async ensureDir() {
    await mkdir(dirname(this.filePath), { recursive: true });
  }

  async readDb() {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        ...cloneDefaultDb(),
        ...parsed,
        users: parsed.users || {},
        subscriptions: parsed.subscriptions || {},
        apiKeys: parsed.apiKeys || {},
        sessions: parsed.sessions || {},
        oauthStates: parsed.oauthStates || {},
        usageEvents: parsed.usageEvents || []
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return cloneDefaultDb();
      }
      throw error;
    }
  }

  async writeDb(nextDb) {
    await this.ensureDir();
    await writeFile(this.filePath, JSON.stringify(nextDb, null, 2), 'utf8');
    return nextDb;
  }

  async update(mutator) {
    this.writeChain = this.writeChain.then(async () => {
      const current = await this.readDb();
      const next = await mutator(current);
      return this.writeDb(next);
    });
    return this.writeChain;
  }

  async getSessionWithUser(sessionId) {
    if (!sessionId) {
      return null;
    }

    const db = await this.readDb();
    const session = db.sessions[sessionId];
    if (!session || session.expiresAt < Date.now()) {
      return null;
    }
    const user = db.users[session.userId];
    if (!user) {
      return null;
    }
    return { session, user };
  }

  async createSession(session) {
    await this.update((db) => {
      db.sessions[session.id] = session;
      return db;
    });
  }

  async deleteSession(sessionId) {
    await this.update((db) => {
      delete db.sessions[sessionId];
      return db;
    });
  }

  async storeOauthState(state, createdAt) {
    await this.update((db) => {
      db.oauthStates[state] = { state, createdAt };
      return db;
    });
  }

  async hasOauthState(state) {
    const db = await this.readDb();
    return Boolean(db.oauthStates[state]);
  }

  async deleteOauthState(state) {
    await this.update((db) => {
      delete db.oauthStates[state];
      return db;
    });
  }

  async findUserByGoogleSubject(subject) {
    const db = await this.readDb();
    return (
      Object.values(db.users).find((entry) => entry.provider === 'google' && entry.providerUserId === subject) || null
    );
  }

  async upsertUser(user) {
    await this.update((db) => {
      const current = db.users[user.id] || {};
      db.users[user.id] = {
        ...current,
        ...user,
        isWhitelisted: user.isWhitelisted ?? current.isWhitelisted ?? false
      };
      return db;
    });
    return user;
  }

  async getUserById(userId) {
    const db = await this.readDb();
    return db.users[userId] || null;
  }

  async listUsers(query = '') {
    const db = await this.readDb();
    const normalized = query.trim().toLowerCase();
    return Object.values(db.users)
      .filter((user) => {
        if (!normalized) {
          return true;
        }
        return [user.email, user.name, user.providerUserId, user.id]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalized));
      })
      .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }

  async setUserWhitelist(userId, isWhitelisted) {
    await this.update((db) => {
      if (db.users[userId]) {
        db.users[userId].isWhitelisted = Boolean(isWhitelisted);
        db.users[userId].updatedAt = new Date().toISOString();
      }
      return db;
    });
  }

  async getSubscription(userId) {
    const db = await this.readDb();
    return db.subscriptions[userId] || null;
  }

  async upsertSubscription(subscription) {
    await this.update((db) => {
      db.subscriptions[subscription.userId] = subscription;
      return db;
    });
    return subscription;
  }

  async recordUsage(event) {
    await this.update((db) => {
      db.usageEvents.push(event);
      return db;
    });
  }

  async listUsageEvents(userId, action = null) {
    const db = await this.readDb();
    return db.usageEvents.filter((event) => event.userId === userId && (!action || event.action === action));
  }

  async createApiKey(key) {
    await this.update((db) => {
      db.apiKeys[key.id] = key;
      return db;
    });
    return key;
  }

  async listApiKeys(userId) {
    const db = await this.readDb();
    return Object.values(db.apiKeys).filter((key) => key.userId === userId);
  }

  async revokeApiKey(keyId, userId, revokedAt) {
    await this.update((db) => {
      const key = db.apiKeys[keyId];
      if (key && key.userId === userId) {
        key.status = 'revoked';
        key.revokedAt = revokedAt;
      }
      return db;
    });
  }

  async findActiveApiKeyByHash(keyHash) {
    const db = await this.readDb();
    return Object.values(db.apiKeys).find((entry) => entry.keyHash === keyHash && entry.status === 'active') || null;
  }

  async touchApiKey(keyId, lastUsedAt) {
    await this.update((db) => {
      if (db.apiKeys[keyId]) {
        db.apiKeys[keyId].lastUsedAt = lastUsedAt;
      }
      return db;
    });
  }
}

class PgStore {
  constructor(connectionString) {
    this.pool = new Pool({
      connectionString,
      max: 10,
      ssl: connectionString.includes('supabase.co') ? { rejectUnauthorized: false } : undefined
    });
  }

  async init() {
    await this.pool.query(SCHEMA_SQL);
  }

  async close() {
    await this.pool.end();
  }

  async getSessionWithUser(sessionId) {
    if (!sessionId) {
      return null;
    }

    const { rows } = await this.pool.query(
      `select
         s.id as session_id,
         s.user_id as session_user_id,
         s.created_at as session_created_at,
         s.expires_at as session_expires_at,
         u.*
       from sessions s
       join users u on u.id = s.user_id
       where s.id = $1
       limit 1`,
      [sessionId]
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    const session = mapSessionRow({
      id: row.session_id,
      user_id: row.session_user_id,
      created_at: row.session_created_at,
      expires_at: row.session_expires_at
    });
    const user = mapUserRow(row);

    if (session.expiresAt < Date.now()) {
      await this.deleteSession(sessionId);
      return null;
    }

    return { session, user };
  }

  async createSession(session) {
    await this.pool.query(
      `insert into sessions (id, user_id, created_at, expires_at)
       values ($1, $2, $3::timestamptz, to_timestamp($4 / 1000.0))
       on conflict (id) do update set
         user_id = excluded.user_id,
         created_at = excluded.created_at,
         expires_at = excluded.expires_at`,
      [session.id, session.userId, session.createdAt, session.expiresAt]
    );
  }

  async deleteSession(sessionId) {
    await this.pool.query('delete from sessions where id = $1', [sessionId]);
  }

  async storeOauthState(state, createdAt) {
    await this.pool.query(
      `insert into oauth_states (state, created_at)
       values ($1, to_timestamp($2 / 1000.0))
       on conflict (state) do update set created_at = excluded.created_at`,
      [state, createdAt]
    );
  }

  async hasOauthState(state) {
    const { rows } = await this.pool.query('select 1 from oauth_states where state = $1 limit 1', [state]);
    return Boolean(rows[0]);
  }

  async deleteOauthState(state) {
    await this.pool.query('delete from oauth_states where state = $1', [state]);
  }

  async findUserByGoogleSubject(subject) {
    const { rows } = await this.pool.query(
      `select * from users where provider = 'google' and provider_user_id = $1 limit 1`,
      [subject]
    );
    return mapUserRow(rows[0]);
  }

  async upsertUser(user) {
    const merged = {
      stripeCustomerId: null,
      isWhitelisted: null,
      ...user
    };

    await this.pool.query(
      `insert into users (
         id, email, name, avatar_url, provider, provider_user_id, stripe_customer_id, is_whitelisted, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, coalesce($8, false), $9::timestamptz, $10::timestamptz)
       on conflict (id) do update set
         email = excluded.email,
         name = excluded.name,
         avatar_url = excluded.avatar_url,
         provider = excluded.provider,
         provider_user_id = excluded.provider_user_id,
         stripe_customer_id = coalesce(excluded.stripe_customer_id, users.stripe_customer_id),
         is_whitelisted = coalesce($8, users.is_whitelisted),
         created_at = coalesce(users.created_at, excluded.created_at),
         updated_at = excluded.updated_at`,
      [
        merged.id,
        merged.email || null,
        merged.name || null,
        merged.avatarUrl || null,
        merged.provider || null,
        merged.providerUserId || null,
        merged.stripeCustomerId || null,
        merged.isWhitelisted,
        merged.createdAt,
        merged.updatedAt
      ]
    );

    return merged;
  }

  async getUserById(userId) {
    const { rows } = await this.pool.query('select * from users where id = $1 limit 1', [userId]);
    return mapUserRow(rows[0]);
  }

  async listUsers(query = '') {
    const values = [];
    let sql = 'select * from users';
    const normalized = query.trim();
    if (normalized) {
      values.push(`%${normalized}%`);
      sql += ' where email ilike $1 or name ilike $1 or provider_user_id ilike $1 or id ilike $1';
    }
    sql += ' order by updated_at desc limit 100';
    const { rows } = await this.pool.query(sql, values);
    return rows.map(mapUserRow);
  }

  async setUserWhitelist(userId, isWhitelisted) {
    await this.pool.query(
      `update users
       set is_whitelisted = $2,
           updated_at = now()
       where id = $1`,
      [userId, Boolean(isWhitelisted)]
    );
  }

  async getSubscription(userId) {
    const { rows } = await this.pool.query('select * from subscriptions where user_id = $1 limit 1', [userId]);
    return mapSubscriptionRow(rows[0]);
  }

  async upsertSubscription(subscription) {
    await this.pool.query(
      `insert into subscriptions (
         user_id, stripe_customer_id, stripe_subscription_id, status, plan, current_period_end, updated_at
       ) values ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz)
       on conflict (user_id) do update set
         stripe_customer_id = excluded.stripe_customer_id,
         stripe_subscription_id = excluded.stripe_subscription_id,
         status = excluded.status,
         plan = excluded.plan,
         current_period_end = excluded.current_period_end,
         updated_at = excluded.updated_at`,
      [
        subscription.userId,
        subscription.stripeCustomerId || null,
        subscription.stripeSubscriptionId || null,
        subscription.status || null,
        subscription.plan || null,
        subscription.currentPeriodEnd || null,
        subscription.updatedAt
      ]
    );
    return subscription;
  }

  async recordUsage(event) {
    await this.pool.query(
      `insert into usage_events (id, user_id, api_key_id, action, meta, created_at)
       values ($1, $2, $3, $4, $5::jsonb, $6::timestamptz)`,
      [event.id, event.userId, event.apiKeyId, event.action, JSON.stringify(event.meta || {}), event.createdAt]
    );
  }

  async listUsageEvents(userId, action = null) {
    const values = [userId];
    let sql = 'select * from usage_events where user_id = $1';
    if (action) {
      values.push(action);
      sql += ' and action = $2';
    }
    sql += ' order by created_at asc';
    const { rows } = await this.pool.query(sql, values);
    return rows.map(mapUsageEventRow);
  }

  async createApiKey(key) {
    await this.pool.query(
      `insert into api_keys (
         id, user_id, name, key_prefix, key_hash, status, created_at, last_used_at, revoked_at
       ) values ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz, $9::timestamptz)`,
      [
        key.id,
        key.userId,
        key.name,
        key.keyPrefix,
        key.keyHash,
        key.status,
        key.createdAt,
        key.lastUsedAt || null,
        key.revokedAt || null
      ]
    );
    return key;
  }

  async listApiKeys(userId) {
    const { rows } = await this.pool.query('select * from api_keys where user_id = $1 order by created_at desc', [userId]);
    return rows.map(mapApiKeyRow);
  }

  async revokeApiKey(keyId, userId, revokedAt) {
    await this.pool.query(
      `update api_keys
       set status = 'revoked', revoked_at = $3::timestamptz
       where id = $1 and user_id = $2`,
      [keyId, userId, revokedAt]
    );
  }

  async findActiveApiKeyByHash(keyHash) {
    const { rows } = await this.pool.query(
      `select * from api_keys where key_hash = $1 and status = 'active' limit 1`,
      [keyHash]
    );
    return mapApiKeyRow(rows[0]);
  }

  async touchApiKey(keyId, lastUsedAt) {
    await this.pool.query('update api_keys set last_used_at = $2::timestamptz where id = $1', [keyId, lastUsedAt]);
  }
}

class FallbackStore {
  constructor(primary, fallback) {
    this.primary = primary;
    this.fallback = fallback;
    this.active = primary;
  }

  async init() {
    try {
      await this.primary.init();
      this.active = this.primary;
    } catch (error) {
      console.warn(`Database connection failed, using local JSON store: ${error.message}`);
      this.active = this.fallback;
      await this.fallback.init();
    }
  }

  async close() {
    await Promise.all([
      typeof this.primary.close === 'function' ? this.primary.close() : undefined,
      typeof this.fallback.close === 'function' ? this.fallback.close() : undefined
    ]);
  }
}

function createFallbackStore(primary, fallback) {
  const wrapper = new FallbackStore(primary, fallback);
  return new Proxy(wrapper, {
    get(target, prop) {
      if (prop in target) {
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      }

      const value = target.active[prop];
      return typeof value === 'function' ? value.bind(target.active) : value;
    }
  });
}

export function createDataStore({ filePath, databaseUrl, fallbackOnError = true }) {
  if (databaseUrl) {
    const primary = new PgStore(databaseUrl);
    if (!fallbackOnError) {
      return primary;
    }
    return createFallbackStore(primary, new JsonStore(filePath));
  }
  return new JsonStore(filePath);
}

export function resolveDefaultDbPath(appRoot) {
  return join(appRoot, '.data', 'app-db.json');
}

export function getSchemaSql() {
  return SCHEMA_SQL;
}
