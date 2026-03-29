# TodoList Component

A React component for displaying and managing AI task lists in chat interfaces.

## Features

- **Real-time Updates**: Receive task status updates in real-time via SSE connection
- **Collapsible**: Click the header to collapse/expand
- **Pinnable**: When pinned, the component stays visible and doesn't auto-collapse
- **Progress Display**: Shows overall progress bar and completion percentage
- **Status Icons**: Different statuses represented by different icons (⭕🔄✅⚠️)
- **Dependency Display**: Shows dependencies between tasks
- **Notes Display**: Shows notes for each task

## Usage

```tsx
import TodoList from "./components/TodoList";

function ChatPage() {
  return (
    <div>
      <TodoList
        sessionId="your-session-uuid"
        apiBaseUrl="http://localhost:8080"
        initialCollapsed={true}
      />
    </div>
  );
}
```

## Props

| Prop               | Type      | Default  | Description                 |
| ------------------ | --------- | -------- | --------------------------- |
| `sessionId`        | `string`  | Required | Session ID                  |
| `apiBaseUrl`       | `string`  | Required | API base URL                |
| `initialCollapsed` | `boolean` | `true`   | Whether initially collapsed |

## Backend API

### HTTP API

```
GET /api/v1/task/{session_id}
```

Returns complete Task List information.

```
GET /api/v1/task/{session_id}/exists
```

Checks if a Task List exists.

### SSE Events

First, execute the session:

```http
POST /api/v1/execute/{session_id}
Content-Type: application/json

{
  "model": "your-model-name"
}
```

Then connect to events:

```http
GET /api/v1/events/{session_id}
```

Example:

```javascript
const eventSource = new EventSource("/api/v1/events/session-123");
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === "task_list_updated") {
    console.log("Task list updated:", data.task_list);
  }
};
```

## AI Tools

AI can manage task lists through the following tools:

### Task

Create or replace task list:

```json
{
  "tasks": [
    { "content": "Analyze code", "status": "in_progress", "activeForm": "Analyzing code" },
    { "content": "Write implementation", "status": "pending" }
  ]
}
```

## Status Descriptions

| Status        | Icon | Description |
| ------------- | ---- | ----------- |
| `pending`     | ⭕   | Pending     |
| `in_progress` | 🔄   | In Progress |
| `completed`   | ✅   | Completed   |
| `blocked`     | ⚠️   | Blocked     |

## File Structure

```
TodoList/
├── index.ts           # Exports
├── TodoList.tsx       # Component
├── TodoList.module.css # Styles
├── UsageExample.tsx   # Usage examples
└── README.md          # Documentation
```

## Notes

1. The component automatically connects to SSE, no manual refresh needed
2. If SSE disconnects, it will automatically reconnect
3. When pinned, the component won't collapse
4. Progress bar turns green when 100% complete
5. Supports dark theme (via CSS variables)

## Dark Theme

The component supports dark theme through CSS variables:

```css
:root {
  --bg-primary: #ffffff;
  --bg-secondary: #f5f5f5;
  --text-primary: #333333;
  --primary-color: #1890ff;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #141414;
    --bg-secondary: #1f1f1f;
    --text-primary: #e0e0e0;
    --primary-color: #1890ff;
  }
}
```

Or pass CSS variables through parent component.
