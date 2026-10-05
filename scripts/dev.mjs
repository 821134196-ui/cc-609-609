// 一条命令启动：建库（需要时播种示例数据）→ NestJS 后端 → Vite 前端
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const serverDir = join(root, 'server');
const webDir = join(root, 'web');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: opts.cwd ?? root, shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// 1. 同步 Prisma schema 到 SQLite（首次自动建库 + 生成 client）
run('npx', ['prisma', 'db', 'push'], { cwd: serverDir });

// 2. 空库则播种示例航次与名单（不用 $ 变量，避免被 shell 展开）
const count = spawnSync(
  'node -e "const {PrismaClient}=require(\'@prisma/client\');const p=new PrismaClient();p.voyage.count().then(c=>process.stdout.write(String(c)))"',
  { cwd: serverDir, shell: true, encoding: 'utf8' },
);
if (count.stdout?.trim() === '0') {
  console.log('🌱 数据库为空，播种示例数据…');
  run('npx', ['ts-node', 'prisma/seed.ts'], { cwd: serverDir });
}

// 3. 同时启动后端与前端
const children = [];
function start(name, cmd, args, cwd, color) {
  const ch = spawn(cmd, args, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const tag = (s) =>
    s.toString().split('\n').filter(Boolean).forEach((l) => process.stdout.write(prefix + l + '\n'));
  ch.stdout.on('data', tag);
  ch.stderr.on('data', tag);
  children.push(ch);
}

start('server', 'npx', ['nest', 'start'], serverDir, '36');
start('web', 'npx', ['vite'], webDir, '35');

const shutdown = () => {
  for (const ch of children) ch.kill();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
