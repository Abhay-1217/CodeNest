# CodeNest — Real-Time Collaborative Code Editor

CodeNest is a full-stack collaborative coding platform that allows multiple users to work together in a shared code editor in real time. It combines CRDT-based synchronization, room-based collaboration, persistent document storage and backend-driven code execution.

## Features

- **Real-time collaborative editing:** Multiple users can edit the same document simultaneously using Yjs.
- **User authentication:** Secure registration and login using JWT and bcryptjs.
- **Room management:** Create coding rooms and manage room access.
- **Room invitations:** Invite registered users to collaborate through their email addresses.
- **Access control:** Room owners and authorized members can access their respective rooms.
- **Persistent documents:** Store and restore collaborative Yjs document updates using PostgreSQL.
- **Code execution:** Execute code through the Judge0 CE API.
- **Multiple languages:** JavaScript, Python, Java and C++.
- **Live collaboration:** Track room participants and connection status.
- **Responsive interface:** React-based interface with Tailwind CSS.

## Technology Stack

| Layer | Technologies |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS |
| Code Editor | CodeMirror |
| Backend | Node.js, Express.js |
| Database | PostgreSQL 17 |
| Real-time Communication | Socket.IO, Yjs, y-socket.io |
| Authentication | JWT, bcryptjs |
| Code Execution | Judge0 CE API |
| Database Access | node-postgres (`pg`) |
| Testing | Vitest, React Testing Library, Node.js Test Runner |
| Containerization | Docker, Docker Compose |

## Architecture

### 1. Real-Time Collaboration

CodeNest uses two complementary technologies:

- **Socket.IO:** Handles application-level realtime communication, including room events and participant updates.
- **Yjs:** Maintains the shared collaborative document and merges concurrent edits using CRDT synchronization.

The editor integrates CodeMirror with Yjs through `y-codemirror.next`.

```text
User A                 User B
   |                      |
CodeMirror             CodeMirror
   |                      |
y-codemirror.next      y-codemirror.next
   |                      |
   +-------- Yjs ---------+
              |
          y-socket.io
              |
        Socket.IO Server
              |
          PostgreSQL
```

### 2. Authentication and Room Access

```text
User Registration / Login
          |
          v
    Express API
          |
          v
  Password Verification
          |
          v
      JWT Token
          |
          v
   Authenticated User
          |
          v
    Room Authorization
          |
          v
   Authorized Collaboration
```

Room access is controlled through ownership and membership checks.

### 3. Code Execution

```text
CodeMirror Editor
       |
       v
  Run Code Request
       |
       v
  Express Backend
       |
       v
  Execution Service
       |
       v
   Judge0 CE API
       |
       v
  Execution Result
       |
       v
   Terminal Output
```

The backend handles code execution requests, keeping the frontend independent of the execution provider.

### 4. Document Persistence

Yjs document updates are stored in PostgreSQL. When a collaborative document is initialized again, stored updates can be loaded to reconstruct its previous state.

Database migrations are maintained in `server/migrations`.

## Project Structure

```text
CodeNest/
├── client/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── Dockerfile
│   └── package.json
│
├── server/
│   ├── migrations/
│   ├── services/
│   ├── server.js
│   ├── db.js
│   ├── migrate.js
│   ├── Dockerfile
│   └── package.json
│
├── .github/
│   └── workflows/
│       └── ci.yml
├── compose.yaml
├── .dockerignore
├── .gitignore
└── README.md
```

## Getting Started

### Prerequisites

- Node.js 22 or later
- Docker Desktop with Docker Compose
- Git

### 1. Clone the repository

```bash
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd CodeNest
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```env
POSTGRES_PASSWORD=your_secure_database_password
JWT_SECRET=your_long_random_secret
```

Do not commit `.env` or share production secrets.

### 3. Start the application

From the project root:

```bash
docker compose up -d --build
```

Check the running services:

```bash
docker compose ps
```

### 4. Access the application

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend | http://localhost:5000 |
| PostgreSQL | localhost:5432 |

### 5. Run backend tests

```bash
docker compose exec server npm test
```

### 6. Run frontend tests

```bash
cd client
npm ci
npm run test:run
```

### 7. Build the frontend

```bash
npm run build
```

## Testing

The project includes automated tests for frontend components and backend functionality.

| Test Suite | Tests |
|---|---:|
| Frontend | 27 |
| Backend | 49 |
| **Total** | **76** |

The test coverage includes authentication, room access, realtime functionality, database persistence and frontend components.

## Continuous Integration

GitHub Actions is configured to run on pushes and pull requests.

The CI pipeline:

1. Installs frontend dependencies.
2. Runs frontend tests.
3. Builds the frontend.
4. Starts a PostgreSQL 17 service.
5. Installs backend dependencies.
6. Applies database migrations.
7. Runs backend tests.

## Engineering Highlights

- Implemented real-time collaborative editing using Yjs and CRDTs.
- Designed room-based authorization and membership management.
- Integrated PostgreSQL persistence for collaborative document updates.
- Built authenticated REST APIs and Socket.IO communication.
- Integrated an external code execution provider through a backend service layer.
- Added automated frontend and backend testing.
- Containerized the application using Docker Compose.

## Future Improvements

- Collaborative cursors and selection indicators.
- Multi-file project workspaces.
- Document version history.
- Distributed realtime infrastructure and horizontal scaling.
- Additional execution isolation and resource controls.
- Improved monitoring and observability.

## License

This project is developed for educational and portfolio purposes.
