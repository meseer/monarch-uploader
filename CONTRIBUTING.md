# Contributing to Monarch Uploader

Thank you for your interest in contributing! This document provides guidelines for contributing to the project.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/monarch-uploader.git`
3. Install dependencies: `npm install`
4. Create a feature branch: `git checkout -b feature/your-feature-name`

## Development Workflow

1. Make your changes
2. Run the full validation suite:
   ```bash
   npm run lint && npm test && npm run build
   ```
3. Commit with a descriptive message following our [commit conventions](.clinerules/11-commit-messages.md)

## Pull Request Process

1. Update documentation if your change affects user-facing behavior
2. Add tests for new functionality
3. Ensure `npm run build:full` passes with zero errors
4. Submit your PR using the [pull request template](.github/pull_request_template.md)
5. A maintainer will review your PR and may request changes

## Code Style

- Follow existing code patterns and conventions
- Use ES6+ features and TypeScript
- Add JSDoc comments for public functions
- See `.clinerules/` for detailed coding standards

## Reporting Issues

- **Bugs:** Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md)
- **Features:** Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md)
- **Security:** See [SECURITY.md](SECURITY.md) — do **not** open a public issue for security vulnerabilities

## Adding a New Integration

If you want to add support for a new financial institution, see the [Adding a New Integration](docs/runbooks/adding-a-new-integration.md) runbook and the [MBNA reference implementation](docs/decisions/002-mbna-as-reference-implementation.md).

## License

By contributing, you agree that your contributions will be licensed under the same [CC BY-NC-SA 4.0](LICENSE) license as the project. This means:

- ✅ Your contributions remain open source
- ✅ Attribution is required for any use of the code
- ❌ Commercial use of the code is not permitted without separate agreement