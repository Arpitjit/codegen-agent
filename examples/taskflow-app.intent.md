Create a frontend-only React TypeScript Vite app named TaskFlow.

Purpose:
- Help a user manage personal tasks across projects.
- The app should feel like a polished productivity workspace, not a toy todo list.

Technology:
- React
- TypeScript
- Vite
- Plain CSS
- No backend
- No API keys
- Store data in localStorage

Core features:
- Show a dashboard with task summary cards:
  - total tasks
  - completed tasks
  - overdue tasks
  - tasks due today
- Let the user create a task with:
  - title
  - project
  - priority: low, medium, high
  - due date
  - notes
- Let the user edit and delete tasks.
- Let the user mark tasks complete/incomplete.
- Let the user filter tasks by:
  - all
  - active
  - completed
  - overdue
  - due today
- Let the user search tasks by title, project, or notes.
- Let the user sort tasks by:
  - due date
  - priority
  - newest first
- Seed the app with realistic sample tasks on first load.

UI requirements:
- Use a modern focused productivity style.
- Use a clean app shell with a top bar, summary cards, task form panel, filters, and task list.
- Use semantic CSS classes, not Tailwind utility classes.
- Define every visual class used by JSX in src/index.css.
- Make it responsive for desktop and mobile.
- Use clear empty, loading-like, and validation states.
- Include accessible labels for form fields.
- Use tasteful colors: deep ink text, calm blue accents, soft green success, warm amber priority, and subtle neutral surfaces.
- Avoid a generic admin dashboard look.

Implementation requirements:
- Keep task types in a separate file.
- Keep localStorage logic in a separate storage service.
- Keep task filtering/sorting logic in a separate utility module.
- Include tests for:
  - filtering tasks
  - sorting tasks
  - localStorage serialization if practical
- Include README usage notes.

Preview requirements:
- The preview should show the intended final app experience.
- Include realistic sample projects and tasks.
- Show summary cards, the create-task form, filters, search, and task list.
- The preview should look modern and polished enough to guide the final React implementation.
