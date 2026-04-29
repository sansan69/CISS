import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:ciss_mobile/app/app.dart';

void main() {
  testWidgets('renders mobile role hub', (WidgetTester tester) async {
    await tester.pumpWidget(const ProviderScope(child: CissMobileApp()));
    await tester.pumpAndSettle();

    expect(find.text('Guard App'), findsOneWidget);
    expect(find.text('Field Officer App'), findsOneWidget);
  });
}
