## 1. High-level application description

This application is a lightweight web tool that turns **floor plans (PDF or image)** into **cleaning plans (DOCX)** using Google’s **Gemini 3 Pro** model.

Users can:

* Upload one or more floor plans.
* Optionally upload a cleaning-plan template from a similar project (their own or a Cleansync template).
* Configure how room names and square meters should be interpreted (checkboxes).
* See an **editable preview** of the generated cleaning plan in the browser.
* Download a **DOCX** version that follows the selected template/standard (e.g., Cleansync standard).

Over time, the app evolves through three main versions and two advanced workflows:

* **V1:** Upload a single floor plan → get a generated cleaning plan.
* **V2:** Upload multiple floor plans → get a combined cleaning plan.
* **V3:** Upload floor plans + template → get a cleaning plan that follows the template.
* **Conversion:** Upload a cleaning plan from another company → convert it to Cleansync standard.
* **Batch testing:** Run 100–200 floor plans / cleaning plans through the pipeline to validate robustness and accuracy.

Gemini 3 Pro is used as the core reasoning engine: it reads PDFs and images, understands room layout, room types, room names and approximate square meters, and generates structured cleaning tasks per room. Gemini 3 Pro is multimodal (text + images + PDFs) and supports large contexts, which fits this use case well. ([Google Cloud Documentation][1])

---

## 2. Key user flows & features

### Core flows

1. **V1 – Single floor plan → cleaning plan**

   * Upload one PDF/image floor plan.
   * Choose options:

     * “All room numbers have room names” (checkbox).
     * “All rooms have m² on the drawing” (checkbox).
   * If m² is missing: user provides a reference room width/length or m².
   * App sends the floor plan + options to Gemini 3 Pro.
   * User sees:

     * A **loading bar** while the AI is running.
     * An **editable preview** of the cleaning plan (rooms, frequency, tasks).
     * A button to **download DOCX**.

2. **V2 – Multiple floor plans → combined cleaning plan**

   * Upload several floor plans (e.g., multiple floors or buildings).
   * Same options as V1, but:

     * The app merges all extracted rooms into one structured cleaning plan.
   * Same UI: loading bar, editable preview, DOCX download.

3. **V3 – Floor plan(s) + template**

   * Upload one or more floor plans.
   * Upload an example cleaning plan template (from a similar project) that describes tasks per room type/zone.
   * Gemini 3 Pro:

     * Learns structure, categories, and wording from the template.
     * Applies template style to the new floor plan(s).
   * Output: cleaning plan matches template style, categories, column names, etc.

4. **Convert external cleaning plan → Cleansync standard**

   * Upload a competitor/partner cleaning plan (DOCX, PDF).
   * App calls Gemini 3 Pro with a system prompt that encodes “Cleansync standard” (your existing prompt).
   * Output:

     * A normalized cleaning plan following Cleansync’s structure, terminology, and columns.
     * Preview + DOCX download.

5. **Batch testing (100–200 floor plans / plans)**

   * Admin uploads a zip/folder or selects a dataset of 100–200 files (floor plans and/or existing cleaning plans).
   * The server runs a batch pipeline (using Gemini 3 Pro’s Batch API support ([Google AI for Developers][2])).
   * Results are stored in a database:

     * Extracted room list per drawing.
     * Generated cleaning plan.
     * Any model errors/timeouts.
   * Admin UI shows:

     * Success rate.
     * Simple quality metrics (e.g., number of rooms detected vs. expected, presence of m², etc.).
     * Downloadable DOCX and JSON for manual sampling.

---

## 3. How Gemini 3 Pro is used

* **Model**: `gemini-3-pro-preview` from the Gemini API. It supports text, image, video, audio and PDFs as input and text as output, with a 1M token context window. ([Google AI for Developers][2])
* **Use cases in this app:**

  1. **Floor plan understanding**

     * Input: Floor plan PDF/image + configuration flags (room names yes/no, m² yes/no, reference room).
     * Output: Structured JSON with:

       * `rooms`: `[ {id, name, type, floor, area_m2, notes} ]`.
  2. **Template understanding**

     * Input: Example cleaning plan (text or parsed from DOCX/PDF) + instructions.
     * Output: JSON schema of sections, columns, room categories, task templates.
  3. **Plan generation**

     * Input: Rooms JSON + template JSON (or default Cleansync schema).
     * Output: Structured cleaning plan as JSON + natural language descriptions for each room.
  4. **Standard conversion**

     * Input: External cleaning plan + “Cleansync standard” system prompt.
     * Output: Normalized JSON that fits Cleansync’s model.

The FastAPI app will wrap these calls using Google’s Gemini REST API / Python client (either via Google AI Studio API or Vertex AI Generative AI endpoints). ([Google Cloud Documentation][1])

---

## 4. FastAPI architecture overview

**Backend (FastAPI, Python):**

* `app/main.py`

  * App factory, routing, middleware (CORS, logging).
* `app/api/routes.py`

  * `/health`
  * `/upload/floorplans` (V1 & V2)
  * `/upload/template` (V3)
  * `/generate-plan` (combine uploaded files + options → Gemini plan)
  * `/convert-plan` (external plan → Cleansync standard)
  * `/batch/run` (trigger batch job on dataset)
  * `/batch/status/{job_id}`
  * `/batch/results/{job_id}`
* `app/services/gemini_client.py`

  * Handles calls to Gemini 3 Pro:

    * `analyze_floorplan(...)`
    * `analyze_template(...)`
    * `generate_plan(...)`
    * `convert_to_cleansync(...)`
* `app/services/docx_generator.py`

  * Uses `python-docx` (or similar) to turn structured JSON into a DOCX file.
* `app/services/storage.py`

  * Local or S3/GCS filesystem handling for uploaded files and generated docs.
* `app/services/config_store.py`

  * Persists admin-managed settings (API keys + system prompt) in SQLite. The Gemini integration reads the key named `gemini` unless `GEMINI_API_KEY` is provided via environment, and it always pulls the latest prompt text configured via `/admin`.
* `app/services/plan_store.py`

  * Persists every generated cleaning plan (generator, converter, batch) in SQLite, along with input metadata and optional DOCX references.
* `app/models/schemas.py`

  * Pydantic models for:

    * `Room`, `CleaningTask`, `CleaningPlan`.
    * Request/response models for each endpoint.
* `app/services/batch_runner.py`

  * Background tasks or simple job queue for batch processing 100–200 files.
* `app/db/*`

  * SQLite helpers used to persist admin configuration (API keys today, ready for jobs/logs/results later).

**Frontend (simple web UI):**

* Can be:

  * Server-side templates (Jinja2) with some JS, or
  * A minimal SPA (React/Vue/Svelte) calling the FastAPI JSON API.
* Core UI pieces:

  * Upload components for floor plans, templates, and external plans.
  * Checkboxes and fields for:

    * “All rooms have room names”
    * “All rooms show m² on drawing”
    * Reference room measurement (if needed).
  * A **progress/loading bar** while waiting for Gemini.
  * An **editable table** for the resulting cleaning plan (add/remove rooms, adjust frequency, update description).
  * Button: “Download DOCX”.

---

## 5. Concrete task breakdown (FastAPI + Gemini 3 Pro)

### Phase 0 – Foundations

1. **Task 0.1 – Project scaffolding**

   * Initialize FastAPI project structure.
   * Set up Poetry/pipenv/requirements.
   * Configure `.env` for Gemini API key & environment.
   * Add basic `/health` endpoint.

2. **Task 0.2 – Gemini 3 Pro client**

   * Implement `gemini_client.py` with:

     * Base class for calling `gemini-3-pro-preview` (using official Gemini API docs). ([Google AI for Developers][2])
     * Helper to send text + file references (PDF/image).
   * Add simple smoke test route (e.g., `/debug/gemini`).

3. **Task 0.3 – File upload & storage**

   * Create `/upload/floorplans` endpoint taking one or multiple files.
   * Store files on disk or in cloud bucket.
   * Return file IDs to the frontend.

---

### Phase 1 – V1: Single floor plan → cleaning plan

4. **Task 1.1 – Floor plan analysis prompt**

   * Design prompt template for: “extract rooms, room types, room names, and area”.
   * Handle two cases:

     * All rooms have m².
     * m² must be inferred from a reference room.

5. **Task 1.2 – `analyze_floorplan` service**

   * Implement Gemini call:

     * Input: file reference, flags, reference room data.
     * Output: JSON list of rooms.
   * Create Pydantic models for `Room`.

6. **Task 1.3 – Plan generation without custom template**

   * Define a default Cleansync-style schema (columns: room name, area, type, frequency, tasks, notes).
   * Implement `generate_plan` service:

     * Takes list of rooms.
     * Uses Gemini to map room type → default cleaning tasks & frequencies.
     * Returns structured `CleaningPlan` JSON.

7. **Task 1.4 – DOCX generation**

   * Implement `docx_generator.py`:

     * Input: `CleaningPlan` JSON.
     * Output: DOCX file path or bytes.
   * Add `/generate-plan` endpoint:

     * Accepts file ID + options.
     * Runs analysis + generation.
     * Responds with:

       * Plan JSON for preview.
       * URL for DOCX download.

8. **Task 1.5 – Basic frontend**

   * Build page:

     * File upload field.
     * Checkboxes for room names and m².
     * Reference room input (visible when needed).
     * Loading bar while calling `/generate-plan`.
     * Editable HTML table bound to the plan JSON.
     * “Download DOCX” button.

---

### Phase 2 – V2: Multiple floor plans

9. **Task 2.1 – Multi-file support in backend**

   * Extend `/upload/floorplans` and `analyze_floorplan` to handle multiple files.
   * Merge results into a single `rooms` list with `floor/building` metadata.

10. **Task 2.2 – UI for multiple floor plans**

    * Allow selection of several files.
    * Show each floor’s rooms grouped in the preview.

11. **Task 2.3 – Performance tuning**

    * Use:

      * Gemini **Batch API** or streaming where applicable. ([Google AI for Developers][2])
    * Add caching for repeated analyses on the same file.

---

### Phase 3 – V3: Template-aware generation

12. **Task 3.1 – Template upload & parsing**

    * Endpoint `/upload/template` for DOCX/PDF templates.
    * Extract raw text and basic structure from template (headings, tables).

13. **Task 3.2 – `analyze_template` service**

    * Prompt Gemini to:

      * Identify structure: sections, room categories, columns.
      * Infer how tasks and frequencies are described.
    * Output a `TemplateSchema` JSON.

14. **Task 3.3 – Template-conditioned plan generation**

    * Extend `generate_plan`:

      * Input: `rooms` + `TemplateSchema`.
      * Output: cleaning plan matching template sections, labels and wording.

15. **Task 3.4 – Frontend template selection**

    * UI:

      * Upload and select template.
      * Show which template is currently active.
      * Indicate that the generated plan follows the chosen template.

---

### Phase 4 – Conversion of external plans to Cleansync standard

16. **Task 4.1 – External plan upload**

    * Endpoint `/upload/external-plan` for competitor PDFs/DOCX.
    * Parse text.

17. **Task 4.2 – `convert_to_cleansync` service**

    * Use your existing Cleansync-standard prompt.
    * Input: raw plan + Cleansync schema description.
    * Output: standardized `CleaningPlan` JSON.

18. **Task 4.3 – UI for conversion**

    * Separate tab:

      * Upload external plan.
      * Option: “Convert to Cleansync format”.
      * Show converted plan in preview (editable) + DOCX download.

---

### Phase 5 – Batch testing & reliability

19. **Task 5.1 – Batch job model & DB**

    * Create `BatchJob` and `BatchResult` tables:

      * Status: pending/running/success/failed.
      * Files, model parameters, metrics.

20. **Task 5.2 – Batch processing pipeline**

    * Endpoint `/batch/run`:

      * Takes a list/zip of floor plans + configuration.
    * Background worker or async tasks:

      * For each file:

        * Analyze floor plan.
        * Generate plan.
        * Store results.
    * Use Batch API for efficiency where possible.

21. **Task 5.3 – Batch monitoring endpoints**

    * `/batch/status/{job_id}` returns progress (e.g., processed/total).
    * `/batch/results/{job_id}` returns summary stats.

22. **Task 5.4 – Admin UI**

    * Simple dashboard:

      * List batch jobs, status, success ratios.
      * Download sample results (DOCX + JSON).
      * Filter by “suspicious” plans (e.g., very few or very many rooms, missing m²).

---

## 6. Deployment (Render.com)

This repo includes a `render.yaml` blueprint that provisions a Render web service for the FastAPI backend and React frontend.

1. **Commit & push**  
   Ensure your latest changes (including `render.yaml`) are pushed to the GitHub/GitLab repo that Render can access.

2. **Create a Blueprint**  
   In Render’s dashboard choose *New ➜ Blueprint*, connect the repository, and select the branch with `render.yaml`. Render will detect the `cleansync-api` web service definition.

3. **Configure service settings**  
   * Keep the default region/plan or adjust to your needs.  
   * `buildCommand` installs Python deps and builds the static frontend (`pip install -r requirements.txt && npm install && npm run build`).  
   * `startCommand` runs `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.

4. **Secrets & env vars**  
   * Add `GEMINI_API_KEY` in the Render dashboard (the blueprint marks it as `sync: false`, so it must be entered manually each time).  
   * Optionally override `PYTHON_VERSION` (defaults to `3.12` from the blueprint) or add more variables as needed.

5. **Persistent storage**  
   The blueprint mounts a Render Disk named `cleansync-storage` at `/opt/render/project/src/storage`, which FastAPI already uses for uploads, generated DOCX files, and SQLite. Adjust the disk size if you expect larger artifacts.

6. **Deploy & verify**  
   Click *Deploy* to kick off the first build. Once live, hit `/health` (e.g., `https://<service>.onrender.com/health`) to confirm FastAPI is running. Frontend assets are served from the `static/` directory that was built during the Render build step.

7. **Next deployments**  
   Push to the tracked branch to trigger automatic deploys (because `autoDeploy: true`). Use Render logs to inspect build/runtime output if something fails.

8. **Custom domain (`cleansync.ai`)**  
   After the first deploy succeeds, open the service’s *Settings ➜ Custom Domains* page in Render, add `cleansync.ai`, and follow the DNS instructions (Render generates the required CNAME/ALIAS records). Once DNS propagates, Render will automatically provision TLS certificates so the FastAPI frontend/API are served from your domain.
