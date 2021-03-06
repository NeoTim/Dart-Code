import { CancellationToken, CodeLens, CodeLensProvider, Event, EventEmitter, TextDocument } from "vscode";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { disposeAll, flatMap } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { LspTestOutlineVisitor } from "../../shared/utils/outline_lsp";
import { getTemplatedLaunchConfigs } from "../../shared/vscode/debugger";
import { lspToRange } from "../../shared/vscode/utils";
import { LspAnalyzer } from "../analysis/analyzer_lsp";
import { isTestFile } from "../utils";

export class LspTestCodeLensProvider implements CodeLensProvider, IAmDisposable {
	private disposables: IAmDisposable[] = [];
	private onDidChangeCodeLensesEmitter: EventEmitter<void> = new EventEmitter<void>();
	public readonly onDidChangeCodeLenses: Event<void> = this.onDidChangeCodeLensesEmitter.event;

	constructor(private readonly logger: Logger, private readonly analyzer: LspAnalyzer) {
		this.disposables.push(this.analyzer.fileTracker.onOutline.listen(() => {
			this.onDidChangeCodeLensesEmitter.fire();
		}));
	}

	public async provideCodeLenses(document: TextDocument, token: CancellationToken): Promise<CodeLens[] | undefined> {
		// Without version numbers, the best we have to tell if an outline is likely correct or stale is
		// if its length matches the document exactly.
		const expectedLength = document.getText().length;
		const outline = await this.analyzer.fileTracker.waitForOutlineWithLength(document, expectedLength, token);
		if (!outline || !outline.children || !outline.children.length)
			return;

		// We should only show the CodeLens for projects we know can actually handle `pub run` (for ex. the
		// SDK codebase cannot, and will therefore run all tests when you click them).
		if (!this.analyzer.fileTracker.supportsPubRunTest(document.uri))
			return;

		// If we don't consider this a test file, we should also not show links (since we may try to run the
		// app with 'flutter run' instead of 'flutter test' which will fail due to no `-name` argument).
		if (!isTestFile(fsPath(document.uri)))
			return;

		const templates = getTemplatedLaunchConfigs(document, "test");

		const visitor = new LspTestOutlineVisitor(this.logger, fsPath(document.uri));
		visitor.visit(outline);
		return flatMap(
			visitor.tests
				.filter((test) => test.range)
				.map((test) => [
					new CodeLens(
						lspToRange(test.range),
						{
							arguments: [test],
							command: "_dart.startWithoutDebuggingTestFromOutline",
							title: "Run",
						},
					),
					new CodeLens(
						lspToRange(test.range),
						{
							arguments: [test],
							command: "_dart.startDebuggingTestFromOutline",
							title: "Debug",
						},
					),
				].concat(templates.map((t) => new CodeLens(
					lspToRange(test.range),
					{
						arguments: [test, t],
						command: t.template === "run-test" ? "_dart.startWithoutDebuggingTestFromOutline" : "_dart.startDebuggingTestFromOutline",
						title: t.name,
					},
				)))),
			(x) => x,
		);
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}
