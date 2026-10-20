STUDYBUDDY - HOW TO PUT IT ONLINE (FREE)

1. Get a Gemini API key: aistudio.google.com -> "Get API key". Note a Flash model name shown there.
2. Make a GitHub account, create a new repository, upload ALL files from this folder
   (keep the "api" folder as is).
3. Make a Vercel account (sign in with GitHub) -> Add New Project -> pick your repository.
4. Before clicking Deploy, open "Environment Variables" and add:
      GEMINI_API_KEY = (your key)
      GEMINI_MODEL   = (the Flash model name from AI Studio)
5. Click Deploy. You get a link like yourname.vercel.app. Share it on WhatsApp.
6. On a phone, open the link in Chrome -> menu -> "Add to Home Screen" to install it like an app.

NEVER paste your API key into index.html or share it.
Free AI limits can change; if you see "Too many requests", wait a minute.
