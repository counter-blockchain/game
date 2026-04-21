# Counter-Blockchain (Online MVP)

Теперь это не просто статичный макет, а **клиент-серверный** проект:

- авторитетный Node.js game-server (tick loop),
- WebSocket-синхронизация игроков,
- матчмейкинг по комнатам,
- серверная физика/урон/очки,
- REST API кошелька и обмена очков на CBT,
- браузерный first-person клиент с лёгким raycasting-рендером.

## Запуск

```bash
npm install
npm start
```

Открой: `http://localhost:8080`

## Что реализовано

### Backend (`server.js`)

- `POST /api/guest` — гостевой токен без регистрации.
- `GET /api/wallet/:token` — баланс очков/CBT.
- `POST /api/exchange` — обмен от 1000 очков => CBT.
- `GET /api/health` — health/онлайн/комнаты.
- `WS /ws` — realtime матч: инпуты, снапшоты, серверная логика.

### Frontend (`index.html`, `game.js`, `styles.css`)

- подключение к серверу,
- сетевой матч с живыми игроками и ботами,
- HUD (hp/ammo/kills/points/players/timer),
- управление от первого лица,
- обмен очков через API.

## Масштабирование до миллионов

Этот репозиторий — рабочий фундамент. Для прод-уровня нужны следующие этапы:

1. Redis/NATS/Kafka для межсерверной шины событий.
2. Вынос матч-серверов в отдельные воркеры + оркестрация (Kubernetes).
3. PostgreSQL/ClickHouse для транзакций/аналитики.
4. Авторизация, античит, rate-limit, audit-лог обмена.
5. Blockchain settlement service (off-chain ledger + on-chain batching).

