import 'package:flutter/material.dart';

import '../../../../shared/widgets/screen_scaffold.dart';
import '../../../../shared/widgets/section_card.dart';

class GuardAttendanceScreen extends StatelessWidget {
  const GuardAttendanceScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const ScreenScaffold(
      title: 'Attendance',
      subtitle: 'Mark and review attendance',
      children: <Widget>[
        SectionCard(
          title: 'Record Attendance',
          subtitle:
              'Select site, duty point, and shift. Upload photo and GPS proof.',
          icon: Icons.how_to_reg_rounded,
        ),
        SectionCard(
          title: 'Attendance History',
          subtitle:
              'Recent check-ins, duty point labels, shifts, and site names.',
          icon: Icons.history_rounded,
        ),
      ],
    );
  }
}

