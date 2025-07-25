#!/bin/bash
# PGBreeder Visualization Linting and Formatting Script
# Usage: ./lint.sh [check|fix]

set -e

cd "$(dirname "$0")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🧬 PGBreeder Visualization Code Quality Check${NC}"
echo "=================================================="

# Check if Node.js and npm are available
if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm is not installed. Please install Node.js and npm first.${NC}"
    exit 1
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📦 Installing dependencies...${NC}"
    npm install
fi

case "${1:-check}" in
    "check")
        echo -e "${BLUE}🔍 Running linter...${NC}"
        if npm run lint; then
            echo -e "${GREEN}✅ Linting passed!${NC}"
        else
            echo -e "${RED}❌ Linting failed! Run './lint.sh fix' to auto-fix issues.${NC}"
            exit 1
        fi

        echo -e "${BLUE}🎨 Checking formatting...${NC}"
        if npm run format:check; then
            echo -e "${GREEN}✅ Formatting is correct!${NC}"
        else
            echo -e "${RED}❌ Formatting issues found! Run './lint.sh fix' to auto-fix.${NC}"
            exit 1
        fi

        echo -e "${GREEN}🎉 All checks passed! Code is clean and ready.${NC}"
        ;;

    "fix")
        echo -e "${BLUE}🔧 Auto-fixing linting issues...${NC}"
        npm run lint:fix

        echo -e "${BLUE}🎨 Auto-formatting code...${NC}"
        npm run format

        echo -e "${GREEN}✅ Auto-fix complete!${NC}"
        echo -e "${YELLOW}💡 Please review the changes before committing.${NC}"
        ;;

    *)
        echo "Usage: $0 [check|fix]"
        echo ""
        echo "Commands:"
        echo "  check  - Run linting and formatting checks (default)"
        echo "  fix    - Auto-fix linting and formatting issues"
        echo ""
        echo "Examples:"
        echo "  $0        # Run checks"
        echo "  $0 check  # Run checks"
        echo "  $0 fix    # Auto-fix issues"
        exit 1
        ;;
esac
