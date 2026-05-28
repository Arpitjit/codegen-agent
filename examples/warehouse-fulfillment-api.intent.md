Create an Express ECS Fargate API for a warehouse fulfillment platform.

Use Node.js 20, TypeScript, Express, npm, Docker, Vitest, and Supertest.

API versioning:
- Mount all routes under /api/v1
- Include GET /health

Domain:
- Warehouses store inventory for products.
- Customers place orders.
- Orders reserve inventory.
- Shipments are created from orders.
- Inventory adjustments track restocks, damage, and corrections.

Models:
- Product: id, sku, name, description, price, active
- Warehouse: id, code, name, city, state
- InventoryItem: id, productId, warehouseId, quantityAvailable, quantityReserved
- Customer: id, email, name
- Order: id, customerId, status, items, total, createdAt
- OrderItem: productId, quantity, unitPrice
- Shipment: id, orderId, status, carrier, trackingNumber, shippedAt
- InventoryAdjustment: id, productId, warehouseId, type, quantity, reason, createdAt

API:
- GET /api/v1/products
- GET /api/v1/products/:id
- POST /api/v1/products
- GET /api/v1/warehouses
- GET /api/v1/inventory
- GET /api/v1/inventory/:id
- POST /api/v1/inventory/adjustments
- GET /api/v1/customers
- GET /api/v1/customers/:id
- POST /api/v1/customers
- GET /api/v1/orders
- GET /api/v1/orders/:id
- POST /api/v1/orders
- POST /api/v1/orders/:id/cancel
- GET /api/v1/shipments
- GET /api/v1/shipments/:id
- POST /api/v1/shipments

Business rules:
- Creating an order validates the customer exists.
- Creating an order validates all products exist and are active.
- Creating an order reserves inventory from available stock.
- If inventory is insufficient, return a 409 error with code INSUFFICIENT_INVENTORY.
- Canceling a pending order releases reserved inventory.
- A shipment can only be created for an existing non-canceled order.
- Creating a shipment marks the order status as SHIPPED.
- Inventory adjustments update available quantity and record an adjustment event.

Implementation:
- Use in-memory repositories with seeded sample data.
- Use services for business logic.
- Use controllers and routes per domain.
- Use Zod for request validation.
- Use centralized error handling.
- Use request logging middleware.
- Use response shape { data, status, message } for success.
- Use error shape { code, message, timestamp } for errors.
- Include README usage notes.
- Include Dockerfile suitable for ECS Fargate.
- Include .dockerignore.

Tests:
- Health endpoint test.
- Product list/detail tests.
- Customer create/detail tests.
- Order creation success test.
- Order creation insufficient inventory test.
- Order cancel releases inventory test.
- Shipment creation marks order shipped test.
- Inventory adjustment test.
- Not-found tests for key resources.
