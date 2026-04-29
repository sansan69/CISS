import 'package:dio/dio.dart';

import 'api_config.dart';

class ApiClient {
  ApiClient()
      : dio = Dio(
          BaseOptions(
            baseUrl: ApiConfig.baseUrl,
            connectTimeout: const Duration(seconds: 20),
            receiveTimeout: const Duration(seconds: 25),
            headers: const <String, String>{
              'Content-Type': 'application/json',
            },
          ),
        );

  final Dio dio;
}

