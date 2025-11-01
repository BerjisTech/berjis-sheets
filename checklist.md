# Berjis Sheets: AI Code Generator Guidance Checklist

## Context for AI
This is a self-hosted Google Sheets alternative within the Berjis ecosystem. The architecture follows:
- **Frontend**: Angular SPA at `file-management/sheets/src/`
- **Backend**: Go service at `file-management/sheets/service/`
- **Auth**: Shared via core `api` service (already exists)
- **Pattern**: Same as other file-management apps (docs, notes, slides, pdf)

---

## Phase 1: Project Foundation

### 1.1 Frontend Scaffolding
- [ ] Verify Angular project structure matches ecosystem pattern (check docs/notes for reference)
- [ ] Set up routing (home, spreadsheet editor view, list view)
- [ ] Create shared components directory (toolbar, sidebar, modals)
- [ ] Configure authentication integration with shared `api` service
- [ ] Set up HTTP interceptor for auth tokens
- [ ] Create environment configurations (dev, staging, prod)

### 1.2 Backend Service Setup
- [ ] Initialize Go module at `service/` following logistics pattern
- [ ] Create standard directory structure:
  - `cmd/service/` - main entry point
  - `internal/handlers/` - HTTP handlers
  - `internal/models/` - data models
  - `internal/store/` - database access layer
  - `internal/middleware/` - auth, logging, CORS
  - `migrations/` - database migrations
- [ ] Set up database connection (PostgreSQL recommended)
- [ ] Create Dockerfile following ecosystem pattern
- [ ] Add service to docker-compose.yml
- [ ] Configure nginx routing in `edge/nginx.conf` (e.g., sheets.berjis.tech)

### 1.3 Database Schema Design
- [ ] **sheets** table: id, owner_id, name, created_at, updated_at, is_public, folder_id
- [ ] **sheet_content** table: sheet_id, version, content_json, created_at
- [ ] **sheet_permissions** table: sheet_id, user_id, permission_level (view/edit/admin)
- [ ] **sheet_versions** table: sheet_id, version, content_snapshot, created_at, created_by
- [ ] Create migration files for all tables
- [ ] Add indexes on frequently queried columns (owner_id, sheet_id, user_id)

---

## Phase 2: Core Spreadsheet Functionality

### 2.1 Spreadsheet Library Integration
**Guidance for AI Code Generator:**
- Research and compare: Luckysheet vs x-spreadsheet vs AG Grid
- Luckysheet provides most Google Sheets-like experience but has Chinese documentation
- x-spreadsheet is lighter and more straightforward
- AG Grid offers more control but requires more custom work
- Install chosen library via npm
- Create Angular service wrapper for library API
- Initialize spreadsheet component with basic grid
- Configure toolbar integration (library usually provides toolbar hooks)

### 2.2 File Operations - Backend
**API Endpoints to Implement:**
- [ ] `POST /api/sheets` - Create new spreadsheet
  - Accept: name, initial_data (optional)
  - Return: sheet_id, metadata
  - Store empty/template content in sheet_content table
- [ ] `GET /api/sheets/:id` - Retrieve spreadsheet
  - Validate user permissions
  - Return: metadata + latest content_json
  - Include permission level for current user
- [ ] `PUT /api/sheets/:id` - Update spreadsheet
  - Accept: content_json, version (for conflict detection)
  - Create new version entry
  - Update sheet_content with new data
  - Return: new version number
- [ ] `DELETE /api/sheets/:id` - Soft delete spreadsheet
  - Mark as deleted (add deleted_at column)
  - Preserve data for recovery
- [ ] `GET /api/sheets` - List user's spreadsheets
  - Filter by owner_id or shared permissions
  - Support pagination, sorting, search
  - Return: array of sheet metadata (without content)

### 2.3 File Operations - Frontend
- [ ] Create SpreadsheetService with methods:
  - createSheet(name: string)
  - loadSheet(id: string)
  - saveSheet(id: string, data: any)
  - deleteSheet(id: string)
  - listSheets(filters?: any)
- [ ] Implement auto-save mechanism (debounced, every 30 seconds)
- [ ] Add manual save button with visual feedback
- [ ] Show saving/saved/error states in UI
- [ ] Handle offline scenarios gracefully
- [ ] Implement optimistic UI updates

### 2.4 Permission System
**Backend:**
- [ ] `POST /api/sheets/:id/share` - Share with users
  - Accept: user_id or email, permission_level
  - Create sheet_permissions entry
  - Send notification (if notification system exists)
- [ ] `GET /api/sheets/:id/permissions` - List who has access
- [ ] `PUT /api/sheets/:id/permissions/:user_id` - Update permission level
- [ ] `DELETE /api/sheets/:id/permissions/:user_id` - Revoke access
- [ ] Middleware to check permissions on all sheet operations

**Frontend:**
- [ ] Share modal component with user search/selection
- [ ] Permission level dropdown (view/edit/admin)
- [ ] List of current collaborators with ability to modify
- [ ] Visual indicators for read-only vs editable mode

---

## Phase 3: Real-Time Collaboration

### 3.1 WebSocket Infrastructure
**Backend:**
- [ ] Install WebSocket library (gorilla/websocket recommended)
- [ ] Create WebSocket handler at `/ws/sheets/:id`
- [ ] Implement connection manager:
  - Track active connections per sheet
  - Handle connect/disconnect events
  - Broadcast messages to all connections in a sheet
- [ ] Add authentication to WebSocket handshake
- [ ] Implement heartbeat/ping-pong for connection health

### 3.2 Operational Transform or CRDT
**Guidance for AI Code Generator:**
This is the most complex part. Options:
1. **Use library solution**: Yjs or Automerge (CRDT libraries)
   - Yjs has good TypeScript support and works well with collaborative editors
   - Handles conflict resolution automatically
   - Can sync via WebSocket
2. **Implement simple last-write-wins**: Easier but loses edits
3. **Operational Transform**: More accurate but complex to implement

**Recommended approach:**
- Start with Yjs integration
- Create shared document (Y.Doc) for each spreadsheet
- Sync Y.Doc state via WebSocket
- Store Y.Doc snapshots in database for persistence

**Implementation checklist:**
- [ ] Install Yjs in Angular frontend
- [ ] Install y-websocket provider (or implement custom provider)
- [ ] Create shared Y.Doc for spreadsheet data
- [ ] Bind Y.Doc to spreadsheet library state
- [ ] Implement Go WebSocket server that relays Yjs messages
- [ ] Add Y.Doc snapshot storage in database
- [ ] Test conflict scenarios (simultaneous edits to same cell)

### 3.3 Presence & Cursors
- [ ] Track active users per sheet (name, color, cursor position)
- [ ] Broadcast cursor movements via WebSocket
- [ ] Display colored cursors/selections for other users
- [ ] Show user avatars in toolbar with online status
- [ ] Implement user color assignment (deterministic based on user_id)

### 3.4 Change History
- [ ] Store operation logs (who changed what, when)
- [ ] Create version snapshots (every N operations or time-based)
- [ ] Implement version restore functionality
- [ ] Build version history UI (timeline, diff viewer)
- [ ] Add "restore to this version" capability

---

## Phase 4: Advanced Spreadsheet Features

### 4.1 Formula Engine
**Options for AI Code Generator:**
1. **Use spreadsheet library's built-in engine** (Luckysheet has formulas)
2. **Integrate HyperFormula** (open-source engine by Handsontable)
3. **Build basic engine** (for limited formula set)

**Implementation:**
- [ ] Research if chosen spreadsheet library has formula support
- [ ] If not, integrate HyperFormula or similar
- [ ] Support essential formulas: SUM, AVERAGE, COUNT, IF, VLOOKUP, etc.
- [ ] Implement formula parsing and calculation
- [ ] Handle circular reference detection
- [ ] Support cell references (A1, B2:B10 notation)
- [ ] Add formula autocomplete in cell editor
- [ ] Display formula vs value toggle

### 4.2 Import/Export
**Backend (Go):**
- [ ] Install Excelize library for Excel operations
- [ ] `POST /api/sheets/:id/import` endpoint
  - Accept: Excel file (.xlsx, .xls) or CSV
  - Parse file and convert to internal JSON format
  - Create new sheet_content version
  - Return: sheet metadata
- [ ] `GET /api/sheets/:id/export` endpoint
  - Accept: format parameter (xlsx, csv, pdf)
  - Convert internal JSON to requested format
  - Return: file download
- [ ] Handle large file uploads (streaming, progress tracking)

**Frontend:**
- [ ] File upload component with drag-and-drop
- [ ] Format selector for export (Excel, CSV, PDF)
- [ ] Progress indicators for import/export
- [ ] Preview before import (show data sample)
- [ ] Error handling for malformed files

### 4.3 Formatting & Styling
**Guidance: Most spreadsheet libraries include styling APIs**
- [ ] Cell formatting: bold, italic, underline, strikethrough
- [ ] Font family and size selection
- [ ] Text color and background color pickers
- [ ] Cell borders (style, color, width)
- [ ] Text alignment (left, center, right, top, middle, bottom)
- [ ] Number formats (currency, percentage, date, custom)
- [ ] Conditional formatting rules:
  - Value-based (greater than, less than, equal to)
  - Color scales
  - Data bars
  - Icon sets
- [ ] Cell merging and unmerging
- [ ] Row height and column width adjustment
- [ ] Freeze rows/columns

### 4.4 Data Features
- [ ] Sorting (ascending/descending, multi-column)
- [ ] Filtering (basic filters, filter views)
- [ ] Data validation (dropdown lists, number ranges, custom rules)
- [ ] Find and replace functionality
- [ ] Row/column insertion and deletion
- [ ] Cut/copy/paste with format preservation
- [ ] Undo/redo functionality (local stack + synced operations)

---

## Phase 5: Charts & Visualizations

### 5.1 Chart Integration
**Guidance for AI Code Generator:**
- Luckysheet has built-in charts
- Alternatively, integrate Chart.js or Recharts
- Charts should be embedded in spreadsheet like Google Sheets

**Implementation:**
- [ ] Chart creation dialog (select data range, chart type)
- [ ] Support chart types: line, bar, column, pie, scatter, area
- [ ] Chart editor: titles, legends, axis labels, colors
- [ ] Chart positioning and resizing within spreadsheet
- [ ] Chart data updates when source cells change
- [ ] Export charts with spreadsheet
- [ ] Store chart configuration in content JSON

### 5.2 Pivot Tables (Optional/Advanced)
- [ ] Pivot table builder UI
- [ ] Drag-and-drop field configuration
- [ ] Aggregation functions (sum, count, average, min, max)
- [ ] Pivot table refresh when source data changes

---

## Phase 6: Mobile & Responsive Design

### 6.1 Responsive Layout
- [ ] Detect mobile vs desktop (viewport size)
- [ ] Simplified toolbar for mobile (collapsible, essential actions only)
- [ ] Touch-friendly cell selection and editing
- [ ] Swipe gestures for navigation
- [ ] Virtual scrolling for performance on large sheets
- [ ] Mobile-optimized context menus (bottom sheets instead of dropdowns)

### 6.2 Progressive Web App (PWA)
- [ ] Add service worker for offline caching
- [ ] Implement offline edit queue (sync when back online)
- [ ] App manifest for install prompt
- [ ] Cache static assets and recent spreadsheets
- [ ] Background sync for pending operations

---

## Phase 7: Performance Optimization

### 7.1 Frontend Performance
- [ ] Lazy load spreadsheet library (code splitting)
- [ ] Virtual scrolling for large datasets (library may provide)
- [ ] Debounce auto-save and API calls
- [ ] Optimize change detection in Angular (OnPush strategy)
- [ ] Web Worker for heavy computations (formula calculations)
- [ ] Implement pagination for sheet list view
- [ ] Use CDN for static assets

### 7.2 Backend Performance
- [ ] Database query optimization (explain analyze, add indexes)
- [ ] Implement caching layer (Redis):
  - Cache frequently accessed sheets
  - Cache user permissions
  - Cache active WebSocket connections metadata
- [ ] Connection pooling for database
- [ ] Rate limiting on API endpoints
- [ ] Implement content compression (gzip)
- [ ] Optimize WebSocket message size (binary format if needed)

### 7.3 Scalability Considerations
- [ ] Horizontal scaling strategy:
  - Load balancer in front of Go services
  - Sticky sessions for WebSocket connections
  - Shared state via Redis for multi-instance coordination
- [ ] Database sharding strategy (if user base grows)
- [ ] CDN for static assets and file downloads
- [ ] Monitor memory usage and optimize JSON parsing

---

## Phase 8: Security & Data Protection

### 8.1 Security Hardening
- [ ] Input validation on all API endpoints
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS protection (sanitize user inputs)
- [ ] CSRF token implementation (if not already in shared api)
- [ ] Rate limiting per user (prevent abuse)
- [ ] Audit logging for sensitive operations (share, delete, permission changes)
- [ ] Encrypt sensitive data at rest (consider encrypting content_json)
- [ ] Secure WebSocket connections (WSS with auth validation)

### 8.2 Data Backup & Recovery
- [ ] Automated database backups (daily, retention policy)
- [ ] Point-in-time recovery capability
- [ ] Export all user data (GDPR compliance)
- [ ] Soft delete with recovery window (30 days before permanent deletion)
- [ ] Version history as implicit backup mechanism

---

## Phase 9: User Experience Enhancements

### 9.1 Templates
- [ ] Create template system (blank, budget, calendar, project tracker, etc.)
- [ ] Template gallery in create dialog
- [ ] User-created templates (save as template feature)
- [ ] Template preview before creation
- [ ] Template categories and search

### 9.2 Comments & Suggestions
- [ ] Comment threads on cells or ranges
- [ ] Mention users with @ notation
- [ ] Comment notifications
- [ ] Resolve/unresolve comments
- [ ] Suggestion mode (track changes like Google Docs)
- [ ] Accept/reject suggestions

### 9.3 Search & Organization
- [ ] Full-text search across sheets (content + metadata)
- [ ] Folder system for organizing sheets
- [ ] Starred/favorited sheets
- [ ] Recent sheets quick access
- [ ] Shared with me section
- [ ] Trash/deleted items view with restore

### 9.4 Keyboard Shortcuts
- [ ] Comprehensive keyboard shortcuts (Ctrl+C, Ctrl+V, Ctrl+Z, etc.)
- [ ] Sheet navigation shortcuts (Ctrl+Arrow keys)
- [ ] Quick formula insertion (= key to start formula)
- [ ] Shortcut help dialog (Ctrl+/)
- [ ] Customizable shortcuts (user preferences)

---

## Phase 10: Integration & Extensions

### 10.1 Ecosystem Integration
- [ ] Link to other Berjis apps (embed sheets in docs, notes)
- [ ] Share sheets in communities
- [ ] Reference sheets in logistics workflows
- [ ] Export sheet data to architect for visualization
- [ ] Integration with shared search service

### 10.2 API for External Access
- [ ] Public API documentation
- [ ] API keys for programmatic access
- [ ] REST API for CRUD operations
- [ ] Webhook support (notify external services on changes)
- [ ] Rate limiting for public API

### 10.3 Add-ons/Plugins (Future)
- [ ] Plugin architecture design
- [ ] Custom function registration
- [ ] UI extension points
- [ ] Sample plugins (currency converter, stock prices, etc.)

---

## Phase 11: Testing & Quality

### 11.1 Frontend Testing
- [ ] Unit tests for services (SpreadsheetService, AuthService)
- [ ] Component tests (toolbar, sheet list, share dialog)
- [ ] E2E tests for critical flows (create, edit, save, share)
- [ ] Test offline functionality
- [ ] Cross-browser testing (Chrome, Firefox, Safari, Edge)
- [ ] Mobile device testing (iOS Safari, Chrome Android)

### 11.2 Backend Testing
- [ ] Unit tests for handlers and business logic
- [ ] Integration tests for API endpoints
- [ ] Database migration tests
- [ ] WebSocket connection tests
- [ ] Load testing (concurrent users, large sheets)
- [ ] Security testing (penetration testing, vulnerability scanning)

### 11.3 Performance Testing
- [ ] Benchmark spreadsheet load times (small, medium, large)
- [ ] Test with many concurrent collaborators
- [ ] Measure memory usage with large datasets
- [ ] Profile formula calculation performance
- [ ] Test import/export with large files

---

## Phase 12: Documentation & Deployment

### 12.1 Documentation
- [ ] User guide (getting started, features overview)
- [ ] API documentation (OpenAPI/Swagger)
- [ ] Developer setup guide (README for contributors)
- [ ] Architecture documentation (how components interact)
- [ ] Troubleshooting guide (common issues)
- [ ] Keyboard shortcuts reference
- [ ] Formula function reference

### 12.2 Deployment
- [ ] Production environment setup
- [ ] CI/CD pipeline configuration
- [ ] Database migration strategy for production
- [ ] Monitoring and logging setup (logs aggregation, error tracking)
- [ ] Health check endpoints
- [ ] Rollback procedure
- [ ] Staging environment for pre-production testing

### 12.3 Monitoring & Analytics
- [ ] Application performance monitoring (APM)
- [ ] Error tracking (Sentry or similar)
- [ ] Usage analytics (feature adoption, user engagement)
- [ ] Uptime monitoring
- [ ] Database performance monitoring
- [ ] Alert system for critical issues

---

## Key Technical Decisions for AI Code Generator

### Decision 1: Spreadsheet Library
**Evaluate and choose:**
- **Luckysheet**: Most feature-complete, Google Sheets-like, Chinese docs
- **x-spreadsheet**: Lightweight, easier to integrate, fewer features
- **AG Grid**: Highly customizable, not traditionally spreadsheet-like
- **Handsontable**: Commercial, excellent performance, requires license

### Decision 2: Real-Time Sync Strategy
**Options:**
- **Yjs (CRDT)**: Best for true real-time, handles conflicts automatically
- **Operational Transform**: More traditional, complex to implement correctly
- **Last-write-wins**: Simplest, but loses concurrent edits
- **Lock-based**: Prevents conflicts but limits collaboration

### Decision 3: Formula Engine
**Options:**
- **Built-in (if library provides)**: Easiest integration
- **HyperFormula**: Production-ready, open-source, comprehensive
- **Custom implementation**: Full control, significant effort
- **Hybrid**: Basic formulas custom, complex via library

### Decision 4: File Storage
**Options:**
- **Database (JSON column)**: Simple, transactional, size limits
- **Object storage (S3/MinIO)**: Scalable, cheaper for large files
- **Hybrid**: Metadata in DB, content in object storage

### Decision 5: Scaling Architecture
**Consider:**
- Single instance vs multi-instance Go services
- WebSocket connection distribution (sticky sessions vs message broker)
- Database read replicas for performance
- Redis for caching and pub/sub

---

## Progressive Implementation Strategy

**Recommendation for AI Code Generator:**
Build in this order for fastest time to usable product:

1. **MVP (Minimal Viable Product)**:
   - Basic spreadsheet with library integration
   - Save/load from backend
   - Simple authentication
   - List view

2. **Core Collaboration**:
   - WebSocket connection
   - Basic real-time sync
   - User presence

3. **Essential Features**:
   - Formulas (if not in library)
   - Import/export
   - Sharing/permissions

4. **Polish**:
   - Performance optimization
   - Mobile responsiveness
   - Advanced features (charts, conditional formatting)

5. **Scale**:
   - Monitoring, testing, documentation
   - Production hardening

---

## Common Pitfalls to Warn AI About

1. **State Synchronization**: Don't try to sync entire spreadsheet on every change (too heavy)
2. **Conflict Resolution**: Implement proper CRDT/OT, don't assume last-write-wins is good enough
3. **Memory Leaks**: Spreadsheet libraries can leak, ensure proper cleanup on unmount
4. **Formula Circular References**: Detect and prevent infinite loops
5. **WebSocket Reconnection**: Implement robust reconnection logic with exponential backoff
6. **Large File Imports**: Stream processing, don't load entire file in memory
7. **Permission Checks**: Verify on backend, never trust frontend-only checks
8. **Database N+1 Queries**: Use joins and eager loading for lists
9. **JSON Storage Limits**: PostgreSQL JSON column has 1GB limit, plan accordingly
10. **Copy-Paste Formatting**: Preserve formats correctly, test edge cases

---

## Success Metrics

Track these to measure progress:
- [ ] Time to create and open a new sheet (< 2 seconds)
- [ ] Time to load existing sheet (< 3 seconds for typical size)
- [ ] Concurrent users per sheet without lag (target: 10+)
- [ ] Formula calculation time for complex sheets (< 1 second)
- [ ] Import/export success rate (> 95%)
- [ ] Auto-save reliability (> 99.9%)
- [ ] Real-time sync latency (< 500ms)
- [ ] Mobile usability score
- [ ] Test coverage (> 70% backend, > 60% frontend)

---

## Final Notes for AI Code Generator

- **Follow ecosystem patterns**: Look at how docs/notes/slides are structured and replicate
- **Incremental development**: Build feature by feature, test thoroughly before moving on
- **Refer to library docs**: Spend time understanding chosen spreadsheet library's API
- **Don't reinvent**: Use existing solutions for hard problems (CRDT, formulas, Excel parsing)
- **Think about scale**: Design for growth but don't over-engineer initially
- **Security first**: Validate, sanitize, authenticate everything
- **User experience**: Fast, intuitive, reliable trumps feature-rich but buggy

This is a substantial project. Build systematically, test continuously, and iterate based on real usage.