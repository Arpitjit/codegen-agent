Create a production-ready TypeScript Express REST API named shop-api.

Requirements:
- Use TypeScript, Express, Zod, Vitest, and Supertest.
- Implement users and orders modules.
- Users have id, email, name, and createdAt.
- Orders have id, userId, status, total, and createdAt.
- Include in-memory repositories.
- Include services with validation and clear errors.
- Include REST routes:
  - GET /health
  - GET /users/:id
  - POST /users
  - GET /orders/:id
  - POST /orders
- Return JSON responses with { data, status, message } on success.
- Return JSON errors with { code, message, timestamp }.
- Include unit or integration tests for health, users, and orders.
- Include README with setup, test, and run commands.
