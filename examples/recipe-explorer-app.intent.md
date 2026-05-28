Create a frontend-only React TypeScript Vite app named PantryPilot.

Purpose:
- Help a user discover recipes based on meal names, ingredients, cuisine areas, and categories.
- The app should feel like a polished consumer cooking assistant, not a generic data table.

Technology:
- React
- TypeScript
- Vite
- Plain CSS
- No backend
- No API keys
- Store saved favorite recipes in localStorage

Public API:
- Use TheMealDB public API.
- Base URL: https://www.themealdb.com/api/json/v1/1
- Search meals by name:
  - GET /search.php?s={query}
- Filter meals by ingredient:
  - GET /filter.php?i={ingredient}
- Filter meals by category:
  - GET /filter.php?c={category}
- Filter meals by cuisine area:
  - GET /filter.php?a={area}
- Fetch meal details:
  - GET /lookup.php?i={mealId}
- Fetch categories:
  - GET /categories.php
- Fetch areas:
  - GET /list.php?a=list
- Do not require an API key.

Core features:
- Show a polished recipe discovery dashboard.
- Let the user search recipes by meal name.
- Let the user filter recipes by:
  - ingredient
  - category
  - cuisine area
- Show recipe cards with:
  - image
  - recipe name
  - category if known
  - area/cuisine if known
  - favorite toggle
- Let the user open a selected recipe detail panel.
- Recipe details should show:
  - image
  - recipe name
  - category
  - cuisine area
  - ingredient and measurement list
  - cooking instructions
  - source link if available
  - YouTube link if available
- Let the user save and remove favorites.
- Show a favorites section using localStorage.
- Include loading, empty, and error states.
- Seed the first screen with a friendly default search, such as chicken or pasta.

UI requirements:
- Use a warm, modern cooking-app style.
- Use semantic CSS classes, not Tailwind utility classes.
- Define every visual class used by JSX in src/index.css.
- Use a clean app shell with a top bar, search controls, filter chips/selects, recipe grid, favorites strip, and recipe detail panel.
- Make it responsive for desktop and mobile.
- Include accessible labels for search fields, filters, buttons, and links.
- Use tasteful colors: deep charcoal text, tomato/coral accents, herb green highlights, cream surfaces, and subtle warm shadows.
- Avoid a generic admin dashboard look.

Implementation requirements:
- Keep API calls in a recipe service module.
- Keep recipe-related TypeScript types in a separate file.
- Keep favorite persistence in a separate localStorage service.
- Keep ingredient parsing from TheMealDB detail response in a separate utility function.
- Include tests for:
  - ingredient parsing
  - favorite serialization
  - filtering/search state helpers if practical
- Include README usage notes.

Preview requirements:
- The preview should show the intended final app experience.
- Include realistic recipe cards, filters, favorites, and a recipe detail panel.
- The preview should look modern and polished enough to guide the final React implementation.
