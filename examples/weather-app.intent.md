Create a simple weather web app named SkyCast.

Purpose:
- Let a user search for current weather by city.
- Show useful current weather details in a clean, responsive interface.
- Use a free/open weather API with no backend required.

Data source:
- Use the Open-Meteo APIs.
- Use the Open-Meteo Geocoding API to convert a city name into latitude and longitude:
  - https://geocoding-api.open-meteo.com/v1/search
- Use the Open-Meteo Forecast API for current weather:
  - https://api.open-meteo.com/v1/forecast
- Do not require an API key.

User workflow:
- User lands on the app and sees a polished weather dashboard.
- User enters a city name in a search field.
- User submits the search.
- App geocodes the city.
- App fetches current weather for the first matching location.
- App displays:
  - city and country
  - current temperature
  - apparent temperature
  - weather condition label
  - wind speed
  - humidity if available
  - time of observation
- App handles loading, empty, and error states.

Frontend requirements:
- Use React, TypeScript, and Vite for the final generated app.
- Use plain CSS, no external UI framework.
- The UI should feel like a focused consumer weather app, not a generic admin dashboard.
- Use a modern visual direction with a refined sky-inspired palette: deep navy text, soft cyan and blue surfaces, warm sunrise accent colors, crisp white cards, and subtle glass-like depth.
- Avoid a flat generic blue-only design; use balanced contrast, clear hierarchy, polished spacing, and premium mobile-first details.
- Use a clean layout with a search panel, current weather card, and supporting detail tiles.
- Make it responsive for mobile and desktop.
- Include accessible labels for form controls.
- Include clear empty-state text before the user searches.
- Include helpful error messages for no city found or API failure.

Implementation requirements:
- Keep API calls in a small weather service module.
- Keep weather-related TypeScript types in a separate file.
- Map Open-Meteo weather codes to readable labels.
- Avoid hardcoded API keys.
- Include README instructions.
- Include tests for weather code mapping and basic UI behavior if practical.

Preview requirements:
- The preview should show the intended final user experience.
- Include a realistic example for Chicago, United States.
- Include a search box, current temperature, condition, wind speed, humidity, and observation time.
- The preview can use static mock data, but it should visually match the intended final app.
- The preview should look modern and visually strong, with a polished weather-app color system, atmospheric but readable background, high-quality typography, and attractive forecast/detail cards.
- The preview should not look like a plain wireframe or default template.
