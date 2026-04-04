# LinkedIn Job URL Extractors

Two tools for extracting job URLs from LinkedIn search results.

---

## ⚡ Option 1: Browser Console Script (RECOMMENDED)

**Fast, safe, no installation needed**

### ⭐ Manual-Assist Collector (BEST - ACTUALLY WORKS)
**File:** `linkedin-job-url-collector-manual.js`
**Use when:** LinkedIn's job list doesn't use href links (most common now)

**How it works:**
- Run script in console once
- Click through jobs manually (or use arrow keys ↓/↑)
- Script watches URL and captures each job ID automatically
- Type `downloadUrls()` when done
- URLs copied to clipboard + downloaded

**Advantages:**
- ✅ Works with LinkedIn's current page structure
- ✅ Simple and reliable
- ✅ You control the pace (fast with arrow keys)
- ✅ Can see each job as you capture it
- ✅ Shows progress in console
- ✅ No complex DOM inspection needed

**Instructions:**
1. Open LinkedIn job search results
2. Open console (F12)
3. Paste the script and press Enter
4. Click through jobs (or use ↓ arrow key to go faster)
5. Watch console show: `✅ Job 1: 4292457426`, `✅ Job 2: 4298765432`, etc.
6. When done, type: `downloadUrls()` and press Enter
7. URLs will be copied + downloaded

---

### Version A: Single Page Extractor
**File:** `linkedin-job-url-extractor.js`
**Use when:** Extracting from current page only (quick checks)

### Version B: Multi-Page Extractor (v2)
**File:** `linkedin-job-url-extractor-multi-page.js`
**Use when:** Processing complete search results (all pages)
**Status:** May not work with current LinkedIn layout

**Features:**
- ✅ Automatically scrolls through infinite scroll
- ✅ Automatically clicks "Next" pagination
- ✅ Shows progress in console
- ✅ Stops when no more results found
- ✅ Deduplicates URLs

### Version C: Multi-Page Extractor v3
**File:** `linkedin-job-url-extractor-multi-page-v3.js`
**Use when:** Processing complete search results (all pages)
**Status:** May not work - LinkedIn job lists don't use href links

**Why v3?** LinkedIn uses obfuscated class names that change frequently. V3 uses a robust DOM inspection approach that doesn't rely on specific class names.

**Features:**
- ✅ Works with LinkedIn's obfuscated/hashed class names
- ✅ Inspects ALL links and filters for job URLs
- ✅ Scrolls both main page AND job list container
- ✅ Automatically clicks "Next" pagination
- ✅ Enhanced debugging output
- ✅ Multiple extraction strategies (5 different approaches)
- ✅ Stops when no more results found
- ✅ Deduplicates URLs

### Version D: Multi-Page Extractor v4 ⭐ BEST (LATEST)
**File:** `linkedin-job-url-extractor-multi-page-v4.js`
**Use when:** Processing complete search results (all pages)

**Why v4?** LinkedIn's job list uses JavaScript click handlers, not traditional href links. V4 actually clicks through each job and captures the URL from the browser's address bar.

**How it works:**
1. Finds all job list items on the page
2. Clicks each job one by one
3. Captures the URL from `window.location` after each click
4. Moves to next page and repeats

**Features:**
- ✅ Works with JavaScript-rendered job lists
- ✅ Clicks through each job to capture URL
- ✅ Handles dynamic content and React routing
- ✅ Automatically paginates through all pages
- ✅ Shows progress as it clicks through jobs
- ✅ Deduplicates URLs
- ✅ Visual feedback - you'll see jobs being selected

### How to Use:

1. **Open LinkedIn** and run your saved search
2. **Open browser console:**
   - Chrome/Edge: Press `F12` or `Ctrl+Shift+J` (Cmd+Option+J on Mac)
   - Firefox: Press `F12` or `Ctrl+Shift+K` (Cmd+Option+K on Mac)
   - Safari: Enable Developer menu first, then `Cmd+Option+C`

3. **Copy the manual-assist script** from `linkedin-job-url-collector-manual.js` (⭐ RECOMMENDED - actually works)
4. **Paste into console** and press Enter
5. **Click through jobs!** You can:
   - Click each job in the list
   - Or use arrow keys (↓ to go down, ↑ to go up) - much faster!
   - Script captures each URL automatically
   - Console shows: `✅ Job 1: 4292457426`, `✅ Job 2: 4298765432`, etc.
   - Navigate through pages as needed

6. **When done, type:** `downloadUrls()` in console and press Enter

7. **URLs will be:**
   - ✅ Copied to clipboard
   - ✅ Downloaded as text file to your Downloads folder
   - ✅ Displayed in console with count

8. **Paste URLs to Claude** for automatic processing

### Advantages:
- ✅ No installation required
- ✅ Works in any browser
- ✅ Uses your existing LinkedIn session
- ✅ Doesn't violate ToS (you're manually triggering it)
- ✅ Handles pagination automatically
- ✅ Fast and simple

---

## 🤖 Option 2: Python Automation Script

**Full automation, but requires setup**

⚠️ **WARNING**: May violate LinkedIn's Terms of Service. Use at your own risk.

### Requirements:

```bash
pip install selenium webdriver-manager
```

### How to Use:

1. **Run the script:**
   ```bash
   python linkedin-job-scraper.py
   ```

2. **Browser will open** - log in to LinkedIn manually

3. **Navigate to your saved search** in the browser

4. **Press Enter in terminal** to extract URLs

5. **URLs saved to file** in scripts directory

### Advantages:
- ✅ Can be scheduled/automated
- ✅ Works with headless browser
- ✅ Customizable search parameters

### Disadvantages:
- ❌ Requires Python + Selenium
- ❌ May violate LinkedIn ToS
- ❌ LinkedIn may block/throttle
- ❌ Requires maintenance as LinkedIn changes

---

## 🎯 Recommended Workflow

**Best approach:**

1. Use **Option 1 (Browser Console)** to extract URLs (safe, fast, simple)
2. Paste URLs to Claude
3. Claude automatically:
   - Evaluates each JD (Haiku - cheap & fast)
   - Rejects non-fits with documentation
   - Creates full applications for fits (Sonnet - high quality)
   - Syncs everything to Google Drive

**Example:**
```
# After running browser script, paste to Claude:
https://www.linkedin.com/jobs/view/1234567890/
https://www.linkedin.com/jobs/view/0987654321/
https://www.linkedin.com/jobs/view/1122334455/
...

# Claude handles the rest automatically!
```

---

## 📊 Processing Multiple URLs

Claude can process **20-30 URLs at once**:
- Parallel evaluation with Haiku
- Smart filtering
- Auto-generate applications for fits
- Cost-effective (~$0.10-0.20 for 20 JDs)

---

## 🔒 Privacy & Security Notes

**Option 1 (Browser Console):**
- ✅ Uses your authenticated session
- ✅ No credentials stored
- ✅ No third-party access
- ✅ Runs entirely in your browser

**Option 2 (Python Script):**
- ⚠️ You manually log in (credentials not stored)
- ⚠️ Browser automation may trigger LinkedIn security
- ⚠️ Use at your own risk

---

**Created:** 2026-02-18
**Last Updated:** 2026-02-19

## 🔧 Troubleshooting

**Issue: Script only finds 1 URL**
- **Cause:** LinkedIn's job list uses JavaScript click handlers, not href links in the HTML
- **Solution:** Use v4 (`linkedin-job-url-extractor-multi-page-v4.js`) which clicks through each job
- V4 captures URLs from the browser address bar after clicking each job
- You'll see jobs being selected one by one as the script runs

**Issue: Clipboard error**
- **Cause:** Browser requires page focus for clipboard access
- **Solution:** Script includes fallback - file download always works
- Check your Downloads folder for the text file

**Issue: Script clicks but doesn't find jobs**
- **Cause:** Page structure may have changed or jobs not fully loaded
- **Solution:**
  - Refresh the page and scroll manually first to load jobs
  - Wait a few seconds for jobs to load before running script
  - Check console output to see what the script is finding
