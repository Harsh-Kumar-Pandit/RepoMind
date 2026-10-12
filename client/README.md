# RepoMind Frontend

The frontend for RepoMind is a developer-focused, single-page application built with **React (JavaScript JSX)**, **Vite**, **Tailwind CSS v4**, **React Router v7**, and **TanStack Query**.

It is architected strictly to pair with the RepoMind Express/PostgreSQL backend, supporting repository analysis, grounded AI explanations, manual workspace code editing, diff reviews, checkpoints, and GitHub pull request publishing.

---

## 1. Design System & Tokens

The interface follows a clean, Linear- and GitHub-inspired aesthetic:
- **Warm White (`#F8F8F6`)**: Main application canvas background.
- **Graphite (`#17191D`)**: Fixed 224px sidebar for the authenticated application shell.
- **Text Primary (`#202124`)** & **Secondary (`#5F6368`)**: Restrained, legible typography hierarchy.
- **Muted Violet (`#6D5CE8`)**: Selective accent for primary buttons, active tabs, and focus outlines.
- **Subtle Border (`#E5E5E2`)**: Crisp dividing lines with minimal shadows.
- **Success Green (`#25845B`)** & **Destructive Red (`#C84C4C`)**: Explicit status badges and diff highlights.

A live design system spec can be viewed at `/design-system`.

---

## 2. Directory Layout

```text
client/
├── public/
├── src/
│   ├── components/
│   │   ├── ui/               # Button, Input, Card, Badge, Notification
│   │   └── shared/           # LoadingSpinner, LoadingSkeleton, EmptyState, ErrorState
│   ├── contexts/             # AuthContext (session state & GitHub OAuth initiator)
│   ├── layouts/              # PublicLayout (landing) & AuthenticatedLayout (graphite shell)
│   ├── lib/                  # utils.js (class combining cn helper)
│   ├── pages/                # LandingPage, DesignSystemShowcase, DashboardPlaceholders
│   ├── services/             # Centralized api.js (Axios with credentials) & auth.service.js
│   ├── App.jsx               # React Router tree & QueryClientProvider
│   ├── index.css             # CSS variables & Tailwind directives
│   └── main.jsx              # DOM mount point
├── .env.example              # Development environment variable template
├── .env                      # Local configuration
├── eslint.config.js          # ESLint flat config
├── package.json              # Scripts and dependencies
└── vite.config.js            # Vite configuration with Tailwind plugin
```

---

## 3. Setup & Development

### Installation
```bash
cd client
npm install
```

### Environment Variables
Copy `.env.example` to `.env`:
```env
VITE_API_BASE_URL=http://localhost:5000/api
```

### Commands
- `npm run dev`: Starts the local Vite development server (default port `5173`).
- `npm run build`: Generates the production build in `dist/`.
- `npm run lint`: Runs ESLint across all `.js` and `.jsx` files.
- `npm run preview`: Previews the production build locally.

---

## 4. Backend Authentication & Credentials Policy

- **No Tokens in LocalStorage**: Session tokens are stored in secure `HttpOnly` cookies (`repomind_session`) set by the backend on `/api/auth/github/callback`.
- **CORS Credentials**: All Axios requests set `withCredentials: true`. The backend `CORS_ORIGIN` allowlist must match `http://localhost:5173`.
- **OAuth Initiation**: Login actions redirect to the backend endpoint `/api/auth/github?redirectTo=...` with signed state nonces.

---

## 5. Implementation Roadmap

- **Attempt 1A (Completed)**: Clean JavaScript foundation, Tailwind CSS design system, UI primitives, Public/Authenticated shells, routing, Axios client, and AuthContext.
- **Attempt 2**: Repository overview, repository explorer, AI chat, grounded citations, and chat history.
- **Attempt 3**: Workspace layout, Monaco code editor, manual file CRUD, OCC concurrency handling, unified diff review, and checkpoints.
- **Attempt 4**: GitHub publishing workflow, pull request creation, settings, and final end-to-end audit.
