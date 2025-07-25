# PGBreeder Gene Visualization

Interactive web-based visualization component for exploring pet genetics in Project Gorgon.

## Features

- **Dual View Modes**: Switch between attribute effects and appearance effects
- **Interactive Filtering**: Click table rows and chromosome labels to filter genes
- **Compact Layout**: All genes visible at once with intuitive circle representations
- **Real-time Stats**: Dynamic table showing gene counts and effects
- **Responsive Design**: Works on desktop and mobile devices

## Gene Representation

### Shapes (Allele Types)
- **🔴 Filled Circle**: Dominant genes (D)
- **⭕ Hollow Circle**: Recessive genes (R) 
- **🌗 Half-filled Circle**: Mixed genes (x) - diagonal split
- **⚪ Gray Circle**: Unknown genes (?)

### Colors
#### Attribute Mode
- **🟢 Green**: Positive effects (Intelligence+, Toughness+, etc.)
- **🔴 Red**: Negative effects (Enthusiasm-, Ruggedness-, etc.)
- **⚪ Gray**: No attribute effects

#### Appearance Mode
- **🟠 Orange Tones**: Body color (hue, saturation, intensity)
- **🔵 Blue Tones**: Wing color (hue, saturation, intensity)
- **🟣 Purple Tones**: Scale effects (body, wing, head, tail, antenna)
- **🌹 Pink Tones**: Deformities (leg, antenna)
- **🔷 Cyan Tones**: Particles and particle location
- **🟡 Yellow**: Glow effects

## Development Setup

### Prerequisites
- Node.js (v16 or higher)
- npm

### Installation
```bash
cd visualization
npm install
```

### Development Commands

```bash
# Check code quality (linting + formatting)
npm run check
# or
./lint.sh check

# Auto-fix issues
npm run fix
# or  
./lint.sh fix

# Individual commands
npm run lint          # Check for linting errors
npm run lint:fix      # Auto-fix linting errors
npm run format        # Format code with Prettier
npm run format:check  # Check if code is formatted correctly
```

### Code Quality Tools

This project uses:
- **ESLint**: JavaScript linting (similar to `ruff` for Python)
- **Prettier**: Code formatting
- **Automatic formatting**: Ensures consistent code style

### Before Committing

Always run the linter and formatter:
```bash
./lint.sh check
```

If there are issues, auto-fix them:
```bash
./lint.sh fix
```

## File Structure

```
visualization/
├── gene_viewer.html           # Main visualization component
├── gene_effects_data.js       # Extracted gene data from database
├── gene_api.py               # API server for data access
├── extract_gene_effects.py   # Script to extract data from database
├── package.json              # Node.js dependencies and scripts
├── eslint.config.js          # ESLint configuration
├── .prettierrc.json          # Prettier configuration
├── lint.sh                   # Convenient linting script
└── README.md                 # This file
```

## Usage

### Standalone HTML
Open `gene_viewer.html` directly in a browser to view sample data.

### With API Server
```bash
cd visualization
uv run python gene_api.py
```
Then visit http://localhost:8000

### Updating Gene Data
To refresh gene effects from the database:
```bash
uv run python extract_gene_effects.py
```

## Interactive Features

### View Modes
- Click **"Attributes"** to see breeding effects (positive/negative)
- Click **"Appearance"** to see cosmetic effects (color, scale, etc.)

### Filtering
- **Table Rows**: Click to filter by attribute/appearance type
- **Ctrl+Click**: Multi-select multiple categories
- **Chromosome Labels**: Click to filter by chromosome
- **Effect Filter**: Dropdown to show only positive/negative effects
- **Hide Toggle**: Check to gray out genes with no effects

### Navigation
- **Pet Selection**: Choose different pets from dropdown
- **Hover**: Get detailed information about individual genes
- **Responsive**: Table stays visible even with long genomes

## Data Sources

Gene effects and appearance data are extracted from the PGBreeder database and stored in `gene_effects_data.js`. The extraction script handles both BeeWasp and Horse genomes, with BeeWasp having complete effect data.

## Browser Compatibility

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Mobile browsers (iOS Safari, Chrome Mobile)
- JavaScript ES2021+ features used