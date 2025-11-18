
# Lost & Found Application - Architecture Documentation

## Database Schema

```mermaid
erDiagram
    USERS ||--o{ OTP_VERIFICATIONS : "has"}
    USERS ||--o{ ITEMS : "creates"}

    USERS {
        int id PK
        string email UK
        string password
        string name
        timestamp created_at
        timestamp updated_at
    }

    OTP_VERIFICATIONS {
        int id PK
        int user_id FK
        string otp
        enum purpose
        datetime expires_at
        boolean used
        timestamp created_at
    }

    ITEMS {
        int id PK
        int user_id FK
        string title
        text description
        enum item_type
        string category
        string location
        date item_date
        enum status
        string image_url
        string contact_email
        string contact_phone
        timestamp created_at
        timestamp updated_at
    }
```

### Table Details

#### Users
Stores user account information with authentication support.

| Column | Type | Constraints |
|--------|------|-----------|
| `id` | INT | PRIMARY KEY, AUTO_INCREMENT |
| `email` | VARCHAR(255) | UNIQUE, NOT NULL |
| `password` | VARCHAR(255) | NOT NULL (bcrypt hashed) |
| `name` | VARCHAR(255) | NOT NULL |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMP | AUTO UPDATE |

#### OTP Verifications
Manages one-time passwords for password resets and email verification.

| Column | Type | Constraints |
|--------|------|-----------|
| `id` | INT | PRIMARY KEY, AUTO_INCREMENT |
| `user_id` | INT | FOREIGN KEY → users(id) |
| `otp` | VARCHAR(6) | NOT NULL |
| `purpose` | ENUM | password_reset, email_verification |
| `expires_at` | DATETIME | NOT NULL (10 min expiry) |
| `used` | BOOLEAN | DEFAULT FALSE |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |

#### Items
Stores lost and found item listings.

| Column | Type | Constraints |
|--------|------|-----------|
| `id` | INT | PRIMARY KEY, AUTO_INCREMENT |
| `user_id` | INT | FOREIGN KEY → users(id) |
| `title` | VARCHAR(255) | NOT NULL |
| `description` | TEXT | Optional |
| `item_type` | ENUM | lost, found |
| `category` | VARCHAR(100) | Optional |
| `location` | VARCHAR(255) | Optional |
| `item_date` | DATE | Optional |
| `status` | ENUM | active, resolved, claimed |
| `image_url` | VARCHAR(255) | Optional |
| `contact_email` | VARCHAR(255) | Optional |
| `contact_phone` | VARCHAR(20) | Optional |
| `created_at` | TIMESTAMP | DEFAULT CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMP | AUTO UPDATE |

**Indexes:**
- `idx_items_user_id` on user_id
- `idx_items_type` on item_type
- `idx_items_status` on status
- `idx_otp_user_id` on user_id

---

## Server Architecture

```mermaid
graph TD
    A[Express Server :6000] --> B[CORS Middleware]
    A --> C[JSON Parser]
    A --> D[Static Files]
    
    A --> E[Auth Routes]
    A --> F[Item Routes]
    A --> G[Static Routes]
    
    E --> E1[POST /signup]
    E --> E2[POST /login]
    E --> E3[POST /password]
    E --> E4[POST /reset-password]
    
    F --> F1[GET /items]
    F --> F2[GET /items/user]
    F --> F3[GET /items/:id]
    F --> F4[POST /items]
    F --> F5[PUT /items/:id]
    F --> F6[DELETE /items/:id]
    
    E1 --> DB[(MySQL DB)]
    E2 --> DB
    E3 --> MAIL[Nodemailer]
    E4 --> DB
    F1 --> DB
    F2 --> DB
    F4 --> DB
    F5 --> DB
    F6 --> DB
```

### Authentication Flow

```mermaid
sequenceDiagram
    participant Client
    participant Server
    participant DB
    participant JWT
    participant Email

    Client->>Server: POST /signup
    Server->>DB: Check email exists
    DB-->>Server: Not found
    Server->>Server: Hash password (bcrypt)
    Server->>DB: Insert user
    Server-->>Client: Success

    Client->>Server: POST /login
    Server->>DB: Query user by email
    DB-->>Server: User data
    Server->>Server: Compare passwords (bcrypt)
    Server->>JWT: Generate token (7d expiry)
    JWT-->>Server: Token
    Server-->>Client: Token + User data

    Client->>Server: POST /password (forgot)
    Server->>DB: Find user by email
    Server->>Server: Generate OTP (6 digits)
    Server->>DB: Store OTP (10 min expiry)
    Server->>Email: Send OTP via Gmail
    Email-->>Client: Email received

    Client->>Server: POST /reset-password
    Server->>DB: Verify OTP (not used, not expired)
    Server->>Server: Hash new password
    Server->>DB: Update password + mark OTP used
    Server-->>Client: Success
```

### Item Management Flow

```mermaid
sequenceDiagram
    participant Client
    participant Server
    participant Middleware as verifyToken
    participant DB

    Client->>Server: POST /items (with token)
    Server->>Middleware: Verify JWT
    Middleware-->>Server: userId extracted
    Server->>DB: Insert item with user_id
    DB-->>Server: Success
    Server-->>Client: Item created

    Client->>Server: GET /items
    Server->>DB: Query with filters
    Note over Server: type, status, search support
    DB-->>Server: Items list
    Server-->>Client: JSON response

    Client->>Server: GET /items/user (with token)
    Server->>Middleware: Verify JWT
    Middleware-->>Server: userId extracted
    Server->>DB: Query items WHERE user_id = ?
    DB-->>Server: User's items
    Server-->>Client: JSON response

    Client->>Server: PUT /items/:id (with token)
    Server->>Middleware: Verify JWT
    Server->>DB: Check ownership
    DB-->>Server: Item user_id
    alt User is owner
        Server->>DB: Update item
        Server-->>Client: Updated
    else Not owner
        Server-->>Client: 403 Unauthorized
    end

    Client->>Server: DELETE /items/:id (with token)
    Server->>Middleware: Verify JWT
    Server->>DB: Check ownership
    alt User is owner
        Server->>DB: Delete item
        Server-->>Client: Deleted
    else Not owner
        Server-->>Client: 403 Unauthorized
    end
```

---

## Client Search & Filter Logic

```mermaid
graph LR
    A[Filter Form] --> B{Search Input}
    A --> C{Type Filter}
    A --> D{Status Filter}
    
    B --> E[URL Builder]
    C --> E
    D --> E
    
    E --> F["GET /api/items?search=...&type=...&status=..."]
    F --> G{Response}
    
    G --> H[displayItems]
    H --> I[Render Grid]
    I --> J[Item Cards]
```

### Filter Parameters

| Parameter | Type | Values |
|-----------|------|--------|
| `search` | String | Searches title & description |
| `type` | String | lost, found |
| `status` | String | active, resolved, claimed |
