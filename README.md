# Staywise — Hotel Room Booking System (SQLite)

A full-stack hotel room booking demo with a responsive HTML/CSS/JavaScript frontend and a Node.js + Express REST API.

## Stack
- **Frontend:** HTML5, CSS3, vanilla JavaScript (Fetch API)
- **Backend:** Node.js + Express
- **Database:** SQLite via `@libsql/client`
- **Hosting:** Vercel

## Important database deployment note
Locally, the app stores data in `hotel_booking.db` in the project root. A SQLite file stored inside a Vercel serverless deployment is **not reliable persistent storage**: writes may be lost between invocations or deployments. For persistent data on Vercel, this project supports **Turso**, a hosted SQLite-compatible database. It is still SQLite-compatible and does not use MongoDB.

## Features
- Add, list, edit and delete rooms; duplicate room numbers are rejected.
- Search room availability by check-in/check-out dates.
- Create bookings and prevent overlapping reservations for the same room.
- Cancel bookings while retaining booking history.
- Responsive dashboard, validation and helpful API errors.
- Health endpoint: `/api/health`.

## Run locally with SQLite
Requires Node.js 20+.

```bash
npm install
npm start
```

Open `http://localhost:3000/`. The SQLite database file is created automatically when the API is first used. To use Vercel's local runtime instead, run `npx vercel dev`.

## Deploy to Vercel with persistent SQLite-compatible storage (recommended)
1. Create a database at [Turso](https://turso.tech/) and obtain its database URL and auth token.
2. Push this project to GitHub and import the repository at [Vercel](https://vercel.com/new).
3. In Vercel **Project Settings → Environment Variables**, add:
   - `TURSO_DATABASE_URL` = the Turso database URL (usually starts with `libsql://`)
   - `TURSO_AUTH_TOKEN` = the database auth token
4. Redeploy and test `https://YOUR-DEPLOYMENT.vercel.app/api/health`.

The API creates the required tables automatically. If you deploy without the two Turso variables, the app falls back to a local SQLite file, which is suitable for local development but **not for persistent production data on Vercel**.

## REST API
| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Database connectivity check |
| GET | `/api/rooms` | List rooms |
| GET | `/api/rooms?type=Deluxe&checkIn=2026-11-01&checkOut=2026-11-03` | Filter rooms and check availability |
| POST | `/api/rooms` | Add room: `{ "roomNo":"204", "type":"Deluxe", "price":2500 }` |
| PUT | `/api/rooms/:id` | Update room details |
| DELETE | `/api/rooms/:id` | Delete room if it has no active bookings |
| GET | `/api/bookings` | List bookings with room information |
| POST | `/api/bookings` | Create a booking: `{ "guestName":"Asha Patil", "roomId":1, "checkIn":"2026-11-01", "checkOut":"2026-11-03" }` |
| DELETE | `/api/bookings/:id` | Cancel a booking while retaining its record |

## Practical test checklist
1. Add room `101`, type `Standard`, price `1800`; confirm it appears.
2. Add `101` again; expect a duplicate-room error.
3. Book room `101` for `2026-11-01` to `2026-11-03`.
4. Try booking it for `2026-11-02` to `2026-11-04`; expect HTTP `409` overlap error.
5. Book it for `2026-11-03` to `2026-11-05`; this should be allowed because checkout day is excluded.
6. Cancel a booking and confirm it remains with `Cancelled` status.
7. Try deleting a room with an active booking; expect HTTP `409`.

## Notes
- Dates use half-open hotel stay intervals: check-in is included and check-out is excluded.
- Do not commit `.env`, auth tokens, or database credentials.
- This is a learning/demo project. Add authentication, authorization, rate limiting, and stronger concurrency protections before production use.
