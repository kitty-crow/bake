# Command line

Run `bun src/cli.ts --project tsconfig.json --target=clang --out-dir build/native`. The entry parses options, invokes the project compiler and prints diagnostics. It returns exit status 1 for invalid options or unsuccessful compilation. Use --help for the full option list.
