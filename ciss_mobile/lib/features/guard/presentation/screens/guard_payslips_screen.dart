import 'package:flutter/material.dart';

import '../../../../shared/widgets/screen_scaffold.dart';
import '../../../../shared/widgets/section_card.dart';

class GuardPayslipsScreen extends StatelessWidget {
  const GuardPayslipsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const ScreenScaffold(
      title: 'Payslips',
      subtitle: 'Salary and payroll records',
      children: <Widget>[
        SectionCard(
          title: 'Monthly Payslips',
          subtitle: 'View payroll period, net pay, and downloadable slips.',
          icon: Icons.receipt_long_rounded,
        ),
      ],
    );
  }
}

