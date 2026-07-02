# /skill-installer

Install skill packs from the Claude Labs registry into the current project.

## Usage

```
/skill-installer [pack-names...] — Install specific packs
/skill-installer auto — Auto-detect project type and install matching packs
/skill-installer list — Show all available packs
/skill-installer status — Show installed packs in current project
```

## How it works

1. Read pack definitions from the skill registry (this repo or GitHub)
2. Copy matching skills from registry to current project's .claude/skills/
3. Only project-specific skills are installed — core skills stay global

## Registry location

The skill registry is at: `/Users/futurewave/Documents/dev/orchestratoion_skill_generator`

If this directory doesn't exist locally, clone from: `vibelabs-web/skillsGen`

## Implementation Details

### /skill-installer list

Reads all `packs/*/pack.json` files and displays:

| Pack | Skills | Description |
|------|--------|-------------|
| fastapi-backend | fastapi-latest, python-pro, database-optimizer | FastAPI + Python |
| nextjs-fullstack | react-19, typescript-pro, vercel-review | Next.js apps |
| ... | ... | ... |

### /skill-installer auto

1. Scan the current project directory for detection signals:
   - Check for files listed in each pack's `detect.files`
   - Search `package.json`, `requirements.txt`, `go.mod` for `detect.patterns`
2. Recommend matching packs
3. Use AskUserQuestion to confirm installation
4. Install confirmed packs using `rsync`

### /skill-installer [pack-name1] [pack-name2] ...

1. For each pack name:
   a. Read `packs/{pack-name}/pack.json`
   b. For each skill in the pack:
      - Source: `/Users/futurewave/Documents/dev/orchestratoion_skill_generator/.claude/skills/{skill}/`
      - Destination: `{current-project}/.claude/skills/{skill}/`
      - Copy with: `rsync -a {source}/ {destination}/`
2. Report what was installed with ✅ indicators

### /skill-installer status

1. List skills in current project's `.claude/skills/`
2. Compare against global `~/.claude/skills/`
3. Show which packs are active (mark with 📦)

## Example Workflow

```bash
# List available packs
/skill-installer list

# Auto-detect and install
/skill-installer auto
# → "React + Vite 프로젝트로 감지되었습니다. react-fullstack 팩을 설치할까요?"

# Install specific pack
/skill-installer fastapi-backend

# Check status
/skill-installer status
# → 📦 fastapi-backend (fastapi-latest, python-pro, database-optimizer)
```

## $ARGUMENTS
