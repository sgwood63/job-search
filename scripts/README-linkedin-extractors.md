# LinkedIn Job URL Extractors

One tool for extracting job URLs from LinkedIn search results.

---

## ⚡ Browser Console Script (RECOMMENDED)

**Fast, safe, no installation needed**

### ⭐ Manual-Assist Collector
**File:** `linkedin-job-url-collector-manual.js`
**Use when:** Extracting job URLs from LinkedIn search results

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

### How to Open Console:
- Chrome/Edge: Press `F12` or `Ctrl+Shift+J` (Cmd+Option+J on Mac)
- Firefox: Press `F12` or `Ctrl+Shift+K` (Cmd+Option+K on Mac)
- Safari: Enable Developer menu first, then `Cmd+Option+C`

### Advantages:
- ✅ No installation required
- ✅ Works in any browser
- ✅ Uses your existing LinkedIn session
- ✅ Doesn't violate ToS (you're manually triggering it)
- ✅ Fast and simple

---

## 🎯 Recommended Workflow

**Best approach:**

1. Use the **Browser Console script** to extract URLs (safe, fast, simple)
2. Paste URLs to Claude
3. Claude automatically:
   - Evaluates each JD (Haiku — cheap & fast)
   - Rejects non-fits with documentation
   - Creates full applications for fits (Sonnet — high quality)
   - Saves everything to `$APPLICANT_DIR`

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

- ✅ Uses your authenticated session
- ✅ No credentials stored
- ✅ No third-party access
- ✅ Runs entirely in your browser

---

**Created:** 2026-02-18
**Last Updated:** 2026-04-30

## 🔧 Troubleshooting

**Issue: Script only finds 1 URL**
- **Cause:** LinkedIn's job list uses JavaScript click handlers, not href links in the HTML
- **Solution:** Click through each job manually — the script captures URLs from the browser address bar as you navigate

**Issue: Clipboard error**
- **Cause:** Browser requires page focus for clipboard access
- **Solution:** Script includes fallback — file download always works
- Check your Downloads folder for the text file

**Issue: Script clicks but doesn't find jobs**
- **Cause:** Page structure may have changed or jobs not fully loaded
- **Solution:**
  - Refresh the page and scroll manually first to load jobs
  - Wait a few seconds for jobs to load before running script
  - Check console output to see what the script is finding
