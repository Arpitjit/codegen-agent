Create an Express ECS Fargate API for an orders and shipments service.

Use Node.js 20, TypeScript, Express, npm, Docker.

API:
- GET /api/v1/orders
- GET /api/v1/orders/:id
- GET /api/v1/shipments
- GET /api/v1/shipments/:id

Implementation:
- Use in-memory sample data
- Add Order and Shipment models
- Add services, controllers, routes, and Vitest tests
- Mount routes under /api/v1
- Use the existing template request logging and centralized error handling
- Include README usage notes
