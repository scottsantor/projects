# Database Migrations

Place SQL migration files here. They will be applied in alphabetical order.

Naming convention: `001_create_users.sql`, `002_add_posts.sql`, etc.

Example migration:

```sql
-- 001_create_users.sql
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Apply migrations with: `appkit migrate {app_name} ./migrations`
