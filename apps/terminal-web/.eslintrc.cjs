module.exports = {
	root: true,
	extends: ['eslint:recommended'],
	env: { es2022: true, node: true },
	parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
	ignorePatterns: ['dist', '.eslintrc.cjs'],
	overrides: [
		{
			files: ['src/**/*.ts'],
			parser: '@typescript-eslint/parser',
			parserOptions: { project: './tsconfig.json', tsconfigRootDir: __dirname },
			plugins: ['@typescript-eslint'],
			extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'plugin:@typescript-eslint/recommended-requiring-type-checking'],
			env: { es2022: true, browser: true },
		},
	],
};
