# Helper Scripts

Automation tools to make your job search process more efficient.

## Available Scripts

### new-application.sh
Creates a new application folder with all necessary template files.

**Usage**:
```bash
./scripts/new-application.sh "Company Name" "Role Title" [profile]
```

**Example**:
```bash
./scripts/new-application.sh "Acme Corp" "Senior Product Manager" "product-manager-b2b"
```

**What it creates**:
- Application folder with date-stamped name
- `notes.md` - Main tracking document
- `job-description.md` - Place to paste and analyze JD
- `checklist.md` - Step-by-step application process

### status-summary.sh
Generates a quick overview of your job search status.

**Usage**:
```bash
./scripts/status-summary.sh
```

**Shows**:
- Total applications count
- Recent activity
- Applications needing follow-up
- Quick stats on your setup

**When to use**:
- Weekly reviews
- Before planning your next batch of applications
- When checking on follow-up actions

## Future Script Ideas

As you use this system, you might want to add:

- **profile-stats.sh**: Compare success rates across different profiles
- **response-time-tracker.sh**: Analyze how quickly companies respond
- **interview-prep.sh**: Generate interview prep checklist from application notes
- **weekly-review.sh**: Automated weekly summary report

## Adding Your Own Scripts

1. Create the script file in this directory
2. Make it executable: `chmod +x scripts/your-script.sh`
3. Add documentation to this README
4. Use bash/python/whatever works for you

## Tips

- Run scripts from the project root directory
- Test scripts on dummy data first
- Keep scripts simple and focused on one task
- Add error handling for better user experience
