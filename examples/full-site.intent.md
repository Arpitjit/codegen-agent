Create a complete full-stack TypeScript web application named shop-dashboard.

The generated project must be self-contained and runnable locally.

Project structure:
- backend/
- frontend/
- README.md

Backend requirements:
- Use Node.js, TypeScript, Express, Zod, Vitest, and Supertest.
- Implement an in-memory REST API for users and orders.
- Users have id, email, name, and createdAt.
- Orders have id, userId, status, total, and createdAt.
- Include REST endpoints:
  - GET /health
  - GET /users
  - GET /users/:id
  - POST /users
  - GET /orders
  - GET /orders/:id
  - POST /orders
- Return successful JSON responses as { data, status, message }.
- Return error JSON responses as { code, message, timestamp }.
- Include backend tests for health, users, orders, validation, and not-found behavior.
- Use a local vitest.config.ts with node environment and default reporter.

Frontend requirements:
- Use React, TypeScript, Vite, and plain CSS.
- Create a polished dashboard UI for managing users and orders.
- Include:
  - App shell with header/navigation.
  - Dashboard summary cards.
  - Users list.
  - Create user form.
  - Orders list.
  - Create order form.
  - Loading, empty, and error states.
- Frontend should call the backend REST API with fetch.
- Use responsive layout that works on desktop and mobile.
- Include accessible labels for forms and buttons.
- Avoid external design systems unless package.json includes them.

Root-level requirements:
- Root package.json should include scripts:
  - npm run install:all
  - npm run dev
  - npm run build
  - npm test
- npm run dev should start backend and frontend concurrently if possible.
- Include all dependencies required by scripts and code.
- Include README with setup, run, build, test, and API endpoint instructions.
- Do not rely on parent directory configs.
